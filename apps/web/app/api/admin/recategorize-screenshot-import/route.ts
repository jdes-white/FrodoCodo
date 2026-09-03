import { NextResponse } from "next/server";
import { prisma } from "@frodocodo/db";
import { classifyTransactionBatch } from "@frodocodo/worker";
import { getCategorySuggestionExtractor } from "@/lib/categorySuggestionFactory";
import { recordAuditEvent } from "@/lib/audit";

/**
 * ONE-OFF maintenance endpoint — not part of normal ingestion, not
 * documented as a permanent feature. Retroactively runs the Layer 4 (AI)
 * categorisation added in commit 6cdb7d1 against transactions from the
 * real production screenshot-import batch (3 Sept 2026, ~18:25 Brisbane)
 * that were created before that AI layer existed and are therefore still
 * sitting uncategorised. Re-uploading the same screenshots isn't usable for
 * this because dedupe would just match the existing rows and skip
 * classification entirely — this instead re-classifies the already-persisted
 * rows in place.
 *
 * Deliberately narrow: only `SCREENSHOT_IMPORT` rows created inside the
 * fixed historical window below, and only where `categoryId` is still null
 * and `isUserOverridden` is false — a transaction with a confirmed
 * category, a household rule, or a learned mapping already has a non-null
 * `categoryId` and is excluded by this same filter, so it is never
 * touched. Uses the exact same `classifyTransactionBatch`
 * (`@frodocodo/worker`) normal ingestion calls for both provider sync and
 * screenshot import — no bespoke categorisation logic here, and no
 * screenshot/image bytes exist at this stage to touch or resend (this
 * operates purely on already-persisted transaction rows).
 *
 * Gated by the same operational token as `/api/admin/seed` (`SEED_TOKEN`,
 * header `x-admin-token`) so no new secret needs to be configured. Safe to
 * leave in place afterward — a request once every matching row already has
 * a category is a no-op (`beforeUncategorized: 0`).
 */
const BATCH_WINDOW_START = new Date("2026-09-03T08:00:00Z");
const BATCH_WINDOW_END = new Date("2026-09-03T09:00:00Z");

export async function POST(request: Request): Promise<NextResponse> {
  const token = request.headers.get("x-admin-token") ?? new URL(request.url).searchParams.get("token");
  const expected = process.env.SEED_TOKEN;
  if (!expected) {
    return NextResponse.json({ error: "SEED_TOKEN is not configured on the server" }, { status: 500 });
  }
  if (token !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const candidates = await prisma.transaction.findMany({
    where: {
      sourceType: "SCREENSHOT_IMPORT",
      categoryId: null,
      isUserOverridden: false,
      createdAt: { gte: BATCH_WINDOW_START, lt: BATCH_WINDOW_END },
    },
    select: {
      id: true,
      originalDescription: true,
      amount: true,
      direction: true,
      account: { select: { connection: { select: { householdId: true } } } },
    },
  });

  const beforeUncategorized = candidates.length;
  if (beforeUncategorized === 0) {
    return NextResponse.json({
      ok: true,
      beforeUncategorized: 0,
      message: "No matching uncategorised SCREENSHOT_IMPORT transactions found in the batch window — nothing to do.",
    });
  }

  const byHousehold = new Map<string, typeof candidates>();
  for (const tx of candidates) {
    const householdId = tx.account.connection.householdId;
    if (!byHousehold.has(householdId)) byHousehold.set(householdId, []);
    byHousehold.get(householdId)!.push(tx);
  }

  const extractor = getCategorySuggestionExtractor();
  let deterministicResolved = 0;
  let aiAutoAssigned = 0;
  let stillUnresolved = 0;
  const merchantsSentToAi = new Set<string>();
  const sampleByMerchantId = new Map<
    string,
    { merchantName: string; categoryName: string | null; source: string | null; confidence: number | null }
  >();

  for (const [householdId, txs] of byHousehold) {
    const items = txs.map((t) => ({
      key: t.id,
      originalDescription: t.originalDescription,
      amount: t.amount.toString(),
      direction: t.direction,
    }));

    const results = await classifyTransactionBatch(householdId, items, extractor);
    const categories = await prisma.category.findMany({ where: { householdId }, select: { id: true, name: true } });
    const categoryNameById = new Map(categories.map((c) => [c.id, c.name]));

    for (const tx of txs) {
      const result = results.get(tx.id)!;

      await prisma.transaction.update({
        where: { id: tx.id },
        data: {
          normalizedMerchantId: result.merchantId,
          merchantConfidence: result.merchantConfidence,
          categoryId: result.categoryId,
          classificationConfidence: result.classificationConfidence,
          classificationSource: result.classificationSource,
          suggestedCategoryId: result.suggestedCategoryId,
          suggestedCategorySource: result.suggestedCategorySource,
          suggestedCategoryConfidence: result.suggestedCategoryConfidence,
        },
      });

      const wasDeterministic = result.categoryId !== null && result.classificationSource !== "AI";
      const wasAiAssigned = result.categoryId !== null && result.classificationSource === "AI";

      if (wasDeterministic) {
        deterministicResolved++;
      } else if (wasAiAssigned) {
        aiAutoAssigned++;
        merchantsSentToAi.add(result.merchantId);
      } else {
        stillUnresolved++;
        merchantsSentToAi.add(result.merchantId);
      }

      if (!sampleByMerchantId.has(result.merchantId)) {
        sampleByMerchantId.set(result.merchantId, {
          merchantName: result.merchantNormalizedName,
          categoryName: result.categoryId ? (categoryNameById.get(result.categoryId) ?? null) : null,
          source: result.classificationSource,
          confidence: result.classificationConfidence,
        });
      }
    }

    await recordAuditEvent({
      householdId,
      action: "SCREENSHOT_IMPORT_RECATEGORIZATION",
      entityType: "Household",
      entityId: householdId,
      metadata: {
        batchWindowStart: BATCH_WINDOW_START.toISOString(),
        batchWindowEnd: BATCH_WINDOW_END.toISOString(),
        transactionsConsidered: txs.length,
      },
    });
  }

  return NextResponse.json({
    ok: true,
    beforeUncategorized,
    deterministicResolved,
    transactionsSentToAi: aiAutoAssigned + stillUnresolved,
    uniqueMerchantsSentToAi: merchantsSentToAi.size,
    aiAutoAssigned,
    stillUnresolved,
    samples: [...sampleByMerchantId.values()],
  });
}
