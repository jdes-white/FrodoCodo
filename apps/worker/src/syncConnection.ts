import { prisma } from "@frodocodo/db";
import { toMoney, formatCalendarDate, type ClassificationSource } from "@frodocodo/shared";
import {
  normalizeMerchant,
  resolveDedupe,
  planCategorySuggestionBatch,
  finalizeCategoryBatch,
  detectTransferPairs,
  detectReversals,
  detectRefunds,
  toIngestibleTransactionFields,
  type ExistingTransactionRef,
} from "@frodocodo/ledger";
import type { FinancialDataProvider } from "@frodocodo/providers";
import type { CategorySuggestionBatchExtractor } from "@frodocodo/ai";

/**
 * Runs one connection's incremental sync through the real pipeline (§7,
 * §10, §11, §38, §39): normalize -> dedupe -> classify -> reconcile
 * transfers/refunds. Idempotent — re-running against a provider that
 * returns the same transactions again is a no-op past the first sync,
 * because resolveDedupe recognizes them (this is exactly what makes
 * automatic background sync safe to schedule frequently, §8).
 *
 * Task 7C: `apps/worker/package.json`'s `main`/`exports` point directly at
 * this file, so `apps/web`'s live-connection flow
 * (`apps/web/lib/basiqConnect.ts`) can run the household's very first sync
 * synchronously right after they finish consent — through this exact same
 * function the worker's own scheduled loop calls, never a re-implementation
 * of dedupe/classify/reconcile in apps/web. This file has no top-level
 * side effects (unlike `index.ts`, which starts the interval loop), so
 * importing it is always safe.
 */
export async function syncConnection(
  provider: FinancialDataProvider,
  connectionId: string,
  categorySuggestionExtractor: CategorySuggestionBatchExtractor,
): Promise<void> {
  const connection = await prisma.financialConnection.findUniqueOrThrow({
    where: { id: connectionId },
    include: { accounts: true },
  });

  const syncRun = await prisma.syncRun.create({
    data: { connectionId, trigger: "SCHEDULED", status: "RUNNING" },
  });

  let imported = 0;
  let updated = 0;
  const errors: string[] = [];

  try {
    const sinceDate = connection.lastSyncedAt ? formatCalendarDate(connection.lastSyncedAt) : undefined;
    const result = await provider.syncTransactions(connection.providerConnectionId, { sinceDate });

    const accountByProviderId = new Map(connection.accounts.map((a) => [a.providerAccountId, a]));

    // providerAccount.currentBalance/availableBalance are read off the sync
    // response above and intentionally never touched again here (Task 6C):
    // no currently-required feature reads an account balance -- "how much
    // is left" is budget-remaining, not bank balance -- so only
    // lastSyncedAt (needed for the stale-sync warning in budgetSnapshot.ts)
    // is updated.
    for (const providerAccount of result.accounts) {
      const account = accountByProviderId.get(providerAccount.providerAccountId);
      if (!account) continue;
      await prisma.account.update({
        where: { id: account.id },
        data: { lastSyncedAt: new Date() },
      });
    }

    for (const providerError of result.errors) {
      errors.push(`${providerError.code}: ${providerError.message}`);
    }

    // Collected here, then classified and inserted in one batch after this
    // loop — see the batch-classification block below for why (Layer 4/AI
    // categorisation needs the whole batch's unresolved merchants at once,
    // not one at a time).
    const toCreate: Array<{ ingestible: ReturnType<typeof toIngestibleTransactionFields>; accountId: string }> = [];

    for (const tx of result.transactions) {
      const account = accountByProviderId.get(tx.accountProviderId);
      if (!account) continue;

      const existingForAccount: ExistingTransactionRef[] = (
        await prisma.transaction.findMany({
          where: { accountId: account.id },
          select: { id: true, accountId: true, providerTransactionId: true, transactionDate: true, amount: true, direction: true, status: true },
        })
      ).map((t) => ({
        id: t.id,
        accountId: t.accountId,
        providerTransactionId: t.providerTransactionId,
        transactionDate: formatCalendarDate(t.transactionDate),
        amount: toMoney(t.amount.toString()),
        direction: t.direction,
        status: t.status,
      }));

      // The one sanctioned path from a provider's raw transaction shape
      // into what FrodoCodo will persist (Task 6B) -- `tx.raw` (the
      // provider's full response for this transaction) is never read
      // again past this point, and everything downstream operates only on
      // `ingestible`'s explicit allow-listed fields.
      const ingestible = toIngestibleTransactionFields({
        sourceAccountId: tx.accountProviderId,
        sourceTransactionId: tx.providerTransactionId,
        transactionDate: tx.transactionDate,
        postingDate: tx.postingDate,
        amount: tx.amount,
        direction: tx.direction,
        status: tx.status,
        description: tx.description,
        sourceType: "PROVIDER_SYNC",
        reversalOfSourceTransactionId: tx.reversalOfProviderTransactionId,
      });

      const decision = resolveDedupe(
        {
          accountId: account.id,
          providerTransactionId: ingestible.providerTransactionId,
          transactionDate: ingestible.transactionDate,
          amount: ingestible.amount,
          direction: ingestible.direction,
          status: ingestible.status,
          originalDescription: ingestible.originalDescription,
        },
        existingForAccount,
      );

      if (decision.action === "SKIP_DUPLICATE") continue;

      if (decision.action === "UPDATE_STATUS_TO_POSTED") {
        await prisma.transaction.update({
          where: { id: decision.existingId },
          data: { status: "POSTED", postingDate: ingestible.postingDate ? new Date(ingestible.postingDate) : new Date(ingestible.transactionDate) },
        });
        updated++;
        continue;
      }

      toCreate.push({ ingestible, accountId: account.id });
    }

    if (toCreate.length > 0) {
      const classifications = await classifyTransactionBatch(
        connection.householdId,
        toCreate.map((c, idx) => ({
          key: String(idx),
          originalDescription: c.ingestible.originalDescription,
          amount: c.ingestible.amount.toString(),
          direction: c.ingestible.direction,
        })),
        categorySuggestionExtractor,
      );

      for (let idx = 0; idx < toCreate.length; idx++) {
        const { ingestible, accountId } = toCreate[idx]!;
        const classification = classifications.get(String(idx))!;

        await prisma.transaction.create({
          data: {
            accountId,
            providerTransactionId: ingestible.providerTransactionId,
            transactionDate: new Date(ingestible.transactionDate),
            postingDate: ingestible.postingDate ? new Date(ingestible.postingDate) : null,
            amount: ingestible.amount.toNumber(),
            direction: ingestible.direction,
            status: ingestible.status,
            originalDescription: ingestible.originalDescription,
            sourceType: ingestible.sourceType,
            reversalOfProviderTransactionId: ingestible.reversalOfProviderTransactionId,
            normalizedMerchantId: classification.merchantId,
            merchantConfidence: classification.merchantConfidence,
            categoryId: classification.categoryId,
            classificationConfidence: classification.classificationConfidence,
            classificationSource: classification.classificationSource,
            // When nothing cleared the auto-classify threshold, keep whatever
            // best guess the deterministic/AI layers had (if any) as a hint
            // for the reclassify UI — the transaction is still unambiguously
            // uncategorised (categoryId above stays null) until a human
            // confirms it.
            suggestedCategoryId: classification.suggestedCategoryId,
            suggestedCategorySource: classification.suggestedCategorySource,
            suggestedCategoryConfidence: classification.suggestedCategoryConfidence,
            syncRunId: syncRun.id,
            // No rawProviderPayload field exists anymore (Task 6B): the
            // provider's raw response for this transaction (tx.raw) was
            // already discarded above once `ingestible` was built from it —
            // data FrodoCodo never retains cannot later leak, which is a
            // stronger guarantee than encrypting it at rest ever was (the H3
            // encryption utility, packages/db/src/payloadEncryption.ts,
            // remains available as a general-purpose utility for other
            // sensitive-at-rest data, e.g. a future provider access token —
            // see docs/banking-data-minimisation-audit.md §8 — but nothing
            // in the transaction ingestion path uses it anymore).
          },
        });
        imported++;
      }
    }

    await reconcileTransferReversalsAndRefunds(connection.householdId);

    await prisma.financialConnection.update({ where: { id: connectionId }, data: { lastSyncedAt: new Date() } });
    await prisma.syncRun.update({
      where: { id: syncRun.id },
      data: {
        status: errors.length > 0 ? "PARTIAL" : "SUCCESS",
        completedAt: new Date(),
        accountsSynced: result.accounts.length,
        transactionsImported: imported,
        transactionsUpdated: updated,
        errorMessage: errors.length > 0 ? errors.join("; ") : undefined,
      },
    });
  } catch (err) {
    await prisma.syncRun.update({
      where: { id: syncRun.id },
      data: { status: "FAILED", completedAt: new Date(), errorMessage: err instanceof Error ? err.message : String(err) },
    });
    throw err;
  }
}

export interface ClassifiableTransactionInput {
  /** Caller-defined correlation key — the batch orchestrator's own index/id scheme, returned unchanged in the result map. */
  key: string;
  originalDescription: string;
  /** Positive decimal string — a magnitude, never signed. */
  amount: string;
  direction: "DEBIT" | "CREDIT";
}

export interface BatchedClassificationResult {
  merchantId: string;
  merchantNormalizedName: string;
  merchantConfidence: number;
  categoryId: string | null;
  classificationConfidence: number | null;
  classificationSource: ClassificationSource | null;
  suggestedCategoryId: string | null;
  suggestedCategorySource: ClassificationSource | null;
  suggestedCategoryConfidence: number | null;
}

/**
 * The one shared entry point BOTH real-provider sync (`syncConnection`
 * above) and screenshot import (`apps/web/lib/screenshotImport.ts`) call to
 * turn a batch of freshly-deduplicated, not-yet-persisted transactions into
 * final categorisation fields — including Layer 4 (AI), which previously
 * didn't exist anywhere in the codebase (every call site passed `null` for
 * `resolveClassification`'s AI argument; see the production categorisation
 * diagnosis this closes). Exported for exactly that reuse, the same pattern
 * `reconcileTransferReversalsAndRefunds` below already established for
 * post-insert reconciliation.
 *
 * The actual decision logic — which merchants need an AI opinion at all,
 * and how a returned opinion combines with the existing deterministic
 * layers — lives in `packages/ledger/src/categoryBatchClassification.ts` as
 * pure functions (`planCategorySuggestionBatch` / `finalizeCategoryBatch`);
 * this function is only the DB-touching shell around them: normalize +
 * upsert merchants, fetch rules/categories, call the injected AI extractor
 * once for the whole batch's deduplicated unresolved merchants, then map
 * results back per input `key`.
 *
 * `categorySuggestionExtractor` is injected (never resolved internally),
 * the same DI pattern `ScreenshotVisionExtractor` already uses — production
 * callers pass `getCategorySuggestionExtractor()` (each app keeps its own
 * copy of that small env-gated factory: `apps/web/lib/categorySuggestionFactory.ts`
 * / `apps/worker/src/categorySuggestionFactory.ts`), tests inject a fake.
 * A throwing extractor is treated exactly like "no suggestions" — an
 * Anthropic outage must never block a sync or a screenshot import.
 */
export async function classifyTransactionBatch(
  householdId: string,
  items: ClassifiableTransactionInput[],
  categorySuggestionExtractor: CategorySuggestionBatchExtractor,
): Promise<Map<string, BatchedClassificationResult>> {
  const results = new Map<string, BatchedClassificationResult>();
  if (items.length === 0) return results;

  interface MerchantInfo {
    id: string;
    normalizedName: string;
    defaultCategoryId: string | null;
  }
  const normalizedByKey = new Map<string, { matchKey: string; normalizedName: string; confidence: number }>();
  const merchantByMatchKey = new Map<string, MerchantInfo>();

  for (const item of items) {
    const merchant = normalizeMerchant(item.originalDescription);
    normalizedByKey.set(item.key, merchant);
    if (!merchantByMatchKey.has(merchant.matchKey)) {
      const row = await prisma.merchant.upsert({
        where: { householdId_matchKey: { householdId, matchKey: merchant.matchKey } },
        update: {},
        create: { householdId, normalizedName: merchant.normalizedName, matchKey: merchant.matchKey },
      });
      merchantByMatchKey.set(merchant.matchKey, { id: row.id, normalizedName: row.normalizedName, defaultCategoryId: row.defaultCategoryId });
    }
  }

  const merchantIds = [...new Set([...merchantByMatchKey.values()].map((m) => m.id))];
  const rules = await prisma.merchantRule.findMany({ where: { householdId, merchantId: { in: merchantIds } } });
  const ruleByMerchantId = new Map(rules.map((r) => [r.merchantId, r]));

  const batchItems = items.map((item) => {
    const merchant = normalizedByKey.get(item.key)!;
    const merchantInfo = merchantByMatchKey.get(merchant.matchKey)!;
    const rule = ruleByMerchantId.get(merchantInfo.id);
    return {
      key: item.key,
      matchKey: merchant.matchKey,
      merchantName: merchant.normalizedName,
      amount: item.amount,
      direction: item.direction,
      merchantRule: rule ? { categoryId: rule.categoryId, ruleId: rule.id } : undefined,
      learnedMapping: merchantInfo.defaultCategoryId ? { categoryId: merchantInfo.defaultCategoryId, confidence: 0.85 } : undefined,
    };
  });

  const { deterministicByKey, requests } = planCategorySuggestionBatch(batchItems);

  let aiAnswersByMatchKey = new Map<string, { categoryId: string; confidence: number } | null>();
  let allowedCategoryIds = new Set<string>();
  if (requests.length > 0) {
    const categories = await prisma.category.findMany({ where: { householdId, isArchived: false }, select: { id: true, name: true } });
    allowedCategoryIds = new Set(categories.map((c) => c.id));
    // Content-free diagnostic (category NAMES are the household's own
    // budget labels, not financial/identity data — never a merchant name,
    // description, or amount) — added after a real production batch
    // returned zero AI assignments with no way to tell, from the app's own
    // side, whether this household even had a non-empty category list to
    // offer the model.
    console.log(
      JSON.stringify({
        scope: "categorySuggestion",
        event: "batch_prepared",
        requestedMerchantCount: requests.length,
        categoryCount: categories.length,
        categoryNames: categories.map((c) => c.name),
      }),
    );
    if (categories.length > 0) {
      try {
        aiAnswersByMatchKey = await categorySuggestionExtractor(requests, categories);
      } catch (err) {
        // Anthropic failure must never block sync/import — every unresolved
        // merchant just stays unresolved, same as AI_PROVIDER=stub.
        console.log(
          JSON.stringify({
            scope: "categorySuggestion",
            event: "extractor_threw",
            requestedMerchantCount: requests.length,
            reason: err instanceof Error ? err.message : "unknown error",
          }),
        );
        aiAnswersByMatchKey = new Map();
      }
    }
  }

  if (requests.length > 0) {
    const answeredCount = [...aiAnswersByMatchKey.values()].filter((v) => v !== null).length;
    console.log(
      JSON.stringify({
        scope: "categorySuggestion",
        event: "batch_result",
        requestedMerchantCount: requests.length,
        answeredCount,
        nullCount: requests.length - answeredCount,
      }),
    );
  }

  const outcomes = finalizeCategoryBatch(batchItems, deterministicByKey, aiAnswersByMatchKey, allowedCategoryIds);

  for (const item of items) {
    const merchant = normalizedByKey.get(item.key)!;
    const merchantInfo = merchantByMatchKey.get(merchant.matchKey)!;
    const classification = outcomes.get(item.key)!;
    results.set(item.key, {
      merchantId: merchantInfo.id,
      merchantNormalizedName: merchant.normalizedName,
      merchantConfidence: merchant.confidence,
      categoryId: classification.status === "CLASSIFIED" ? classification.categoryId : null,
      classificationConfidence: classification.status === "CLASSIFIED" ? classification.confidence : null,
      classificationSource: classification.status === "CLASSIFIED" ? classification.source : null,
      suggestedCategoryId: classification.status === "NEEDS_REVIEW" ? (classification.bestGuessCategoryId ?? null) : null,
      suggestedCategorySource: classification.status === "NEEDS_REVIEW" ? (classification.bestGuessSource ?? null) : null,
      suggestedCategoryConfidence: classification.status === "NEEDS_REVIEW" ? (classification.bestGuessConfidence ?? null) : null,
    });
  }

  return results;
}

/**
 * Exported (not just used internally by `syncConnection` above) so the
 * batch screenshot-import pipeline (`apps/web/lib/screenshotImport.ts`)
 * can call it too, after inserting its own transactions — the same
 * transfer/reversal/refund reconciliation must run regardless of which
 * ingestion path produced the new rows.
 *
 * Re-runs the real ledger reconciliation logic (not a re-implementation)
 * across the household's transactions, in a deliberate order — a
 * transaction can be at most one of: transfer leg, reversal leg, or refund
 * leg, so each stage below only considers transactions the earlier stages
 * left unmatched. Transfers run first (the most specific match: two
 * different accounts, exact amount, short window); reversals next (same
 * account, exact amount, opposite direction, very short window — Task 6A's
 * gap, packages/ledger/src/reversalDetection.ts); refunds last (the
 * loosest match: same account, merchant-matched, wider window, credit ≤
 * original).
 */
export async function reconcileTransferReversalsAndRefunds(householdId: string): Promise<void> {
  const transactions = await prisma.transaction.findMany({
    where: { account: { connection: { householdId } }, isTransfer: false, isReversal: false },
    include: { account: true, merchant: true },
  });

  const transferMatches = detectTransferPairs(
    transactions.map((t) => ({
      id: t.id,
      accountId: t.accountId,
      accountType: t.account.accountType,
      amount: t.amount.toString(),
      direction: t.direction,
      transactionDate: formatCalendarDate(t.transactionDate),
    })),
  );
  for (const match of transferMatches) {
    await prisma.transaction.update({
      where: { id: match.debitTransactionId },
      data: { isTransfer: true, isExcludedFromBudget: true, transferGroupId: match.debitTransactionId, counterpartTransactionId: match.creditTransactionId },
    });
    await prisma.transaction.update({
      where: { id: match.creditTransactionId },
      data: { isTransfer: true, isExcludedFromBudget: true, transferGroupId: match.debitTransactionId },
    });
  }

  const notYetTransferMatched = transactions.filter(
    (t) => !transferMatches.some((m) => m.debitTransactionId === t.id || m.creditTransactionId === t.id),
  );

  const reversalMatches = detectReversals(
    notYetTransferMatched.map((t) => ({
      id: t.id,
      accountId: t.accountId,
      providerTransactionId: t.providerTransactionId,
      amount: t.amount.toString(),
      direction: t.direction,
      transactionDate: formatCalendarDate(t.transactionDate),
      reversalOfProviderTransactionId: t.reversalOfProviderTransactionId,
      description: t.originalDescription,
    })),
  );
  for (const match of reversalMatches) {
    await prisma.transaction.update({
      where: { id: match.originalTransactionId },
      data: { isReversal: true, isExcludedFromBudget: true, counterpartTransactionId: match.reversalTransactionId },
    });
    await prisma.transaction.update({
      where: { id: match.reversalTransactionId },
      data: { isReversal: true, isExcludedFromBudget: true },
    });
  }

  const refundCandidates = notYetTransferMatched.filter(
    (t) =>
      t.merchant &&
      !reversalMatches.some((m) => m.originalTransactionId === t.id || m.reversalTransactionId === t.id),
  );
  const refundMatches = detectRefunds(
    refundCandidates.map((t) => ({
      id: t.id,
      accountId: t.accountId,
      merchantMatchKey: t.merchant!.matchKey,
      amount: t.amount.toString(),
      direction: t.direction,
      transactionDate: formatCalendarDate(t.transactionDate),
    })),
  );
  for (const match of refundMatches) {
    const original = transactions.find((t) => t.id === match.originalTransactionId)!;
    await prisma.transaction.update({
      where: { id: match.refundTransactionId },
      data: { refundOfTransactionId: match.originalTransactionId, categoryId: original.categoryId },
    });
  }
}
