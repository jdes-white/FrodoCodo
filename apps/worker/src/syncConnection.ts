import { prisma, encryptForStorage } from "@frodocodo/db";
import { toMoney, formatCalendarDate } from "@frodocodo/shared";
import {
  normalizeMerchant,
  resolveDedupe,
  classifyDeterministic,
  resolveClassification,
  detectTransferPairs,
  detectRefunds,
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

    for (const providerAccount of result.accounts) {
      const account = accountByProviderId.get(providerAccount.providerAccountId);
      if (!account) continue;
      await prisma.account.update({
        where: { id: account.id },
        data: {
          currentBalance: providerAccount.currentBalance.toNumber(),
          availableBalance: providerAccount.availableBalance.toNumber(),
          lastSyncedAt: new Date(),
        },
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

      const decision = resolveDedupe(
        {
          accountId: account.id,
          providerTransactionId: tx.providerTransactionId,
          transactionDate: tx.transactionDate,
          amount: tx.amount,
          direction: tx.direction,
          status: tx.status,
          originalDescription: tx.description,
        },
        existingForAccount,
      );

      if (decision.action === "SKIP_DUPLICATE") continue;

      if (decision.action === "UPDATE_STATUS_TO_POSTED") {
        await prisma.transaction.update({
          where: { id: decision.existingId },
          data: { status: "POSTED", postingDate: tx.postingDate ? new Date(tx.postingDate) : new Date(tx.transactionDate) },
        });
        updated++;
        continue;
      }

      const merchant = normalizeMerchant(tx.description);
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
          providerTransactionId: tx.providerTransactionId,
          transactionDate: new Date(tx.transactionDate),
          postingDate: tx.postingDate ? new Date(tx.postingDate) : null,
          amount: tx.amount.toNumber(),
          direction: tx.direction,
          status: tx.status,
          originalDescription: tx.description,
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
          // Never stored as plaintext (security audit finding H3) — see
          // packages/db/src/payloadEncryption.ts.
          rawProviderPayload: (encryptForStorage(tx.raw) ?? null) as never,
        },
      });
      imported++;
    }

    await reconcileTransfersAndRefunds(connection.householdId);

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

/** Re-runs the real ledger reconciliation logic (not a re-implementation) across the household's transactions. */
async function reconcileTransfersAndRefunds(householdId: string): Promise<void> {
  const transactions = await prisma.transaction.findMany({
    where: { account: { connection: { householdId } }, isTransfer: false },
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

  const refundCandidates = transactions.filter((t) => t.merchant && !transferMatches.some((m) => m.debitTransactionId === t.id || m.creditTransactionId === t.id));
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
