import { prisma } from "@frodocodo/db";
import { toMoney, formatCalendarDate } from "@frodocodo/shared";
import {
  normalizeMerchant,
  resolveDedupe,
  classifyDeterministic,
  resolveClassification,
  detectTransferPairs,
  detectReversals,
  detectRefunds,
  toIngestibleTransactionFields,
  type ExistingTransactionRef,
} from "@frodocodo/ledger";
import type { FinancialDataProvider } from "@frodocodo/providers";

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
export async function syncConnection(provider: FinancialDataProvider, connectionId: string): Promise<void> {
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

      const merchant = normalizeMerchant(ingestible.originalDescription);
      const merchantRow = await prisma.merchant.upsert({
        where: { householdId_matchKey: { householdId: connection.householdId, matchKey: merchant.matchKey } },
        update: {},
        create: { householdId: connection.householdId, normalizedName: merchant.normalizedName, matchKey: merchant.matchKey },
      });

      const rule = await prisma.merchantRule.findUnique({
        where: { householdId_merchantId: { householdId: connection.householdId, merchantId: merchantRow.id } },
      });
      const deterministic = classifyDeterministic({
        merchantRule: rule ? { categoryId: rule.categoryId, ruleId: rule.id } : undefined,
        learnedMapping: merchantRow.defaultCategoryId ? { categoryId: merchantRow.defaultCategoryId, confidence: 0.85 } : undefined,
      });
      // AI suggestion stays out of the real ingestion path deliberately —
      // only the deterministic layers (rule / learned mapping; provider
      // enrichment stays unwired until a real provider exists) ever feed
      // resolveClassification here. See docs/financial-calculation-rules.md
      // and the categorisation audit for why this is intentional for now.
      const classification = resolveClassification(deterministic, null);

      await prisma.transaction.create({
        data: {
          accountId: account.id,
          providerTransactionId: ingestible.providerTransactionId,
          transactionDate: new Date(ingestible.transactionDate),
          postingDate: ingestible.postingDate ? new Date(ingestible.postingDate) : null,
          amount: ingestible.amount.toNumber(),
          direction: ingestible.direction,
          status: ingestible.status,
          originalDescription: ingestible.originalDescription,
          sourceType: ingestible.sourceType,
          reversalOfProviderTransactionId: ingestible.reversalOfProviderTransactionId,
          normalizedMerchantId: merchantRow.id,
          merchantConfidence: merchant.confidence,
          categoryId: classification.status === "CLASSIFIED" ? classification.categoryId : null,
          classificationConfidence: classification.status === "CLASSIFIED" ? classification.confidence : null,
          classificationSource: classification.status === "CLASSIFIED" ? classification.source : null,
          // When nothing cleared the auto-classify threshold, keep whatever
          // best guess the deterministic layer had (if any) as a hint for
          // the reclassify UI — the transaction is still unambiguously
          // uncategorised (categoryId above stays null) until a human
          // confirms it.
          suggestedCategoryId: classification.status === "NEEDS_REVIEW" ? (classification.bestGuessCategoryId ?? null) : null,
          suggestedCategorySource: classification.status === "NEEDS_REVIEW" ? (classification.bestGuessSource ?? null) : null,
          suggestedCategoryConfidence: classification.status === "NEEDS_REVIEW" ? (classification.bestGuessConfidence ?? null) : null,
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

/**
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
async function reconcileTransferReversalsAndRefunds(householdId: string): Promise<void> {
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
