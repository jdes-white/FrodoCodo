import "server-only";
import { prisma } from "@frodocodo/db";
import { classifyTransactionBatch } from "@frodocodo/worker";
import { getCategorySuggestionExtractor } from "./categorySuggestionFactory";
import { recordAuditEvent } from "./audit";

/**
 * TEMPORARY, ONE-OFF maintenance helper — not part of normal ingestion.
 * Safe to delete this file, its server action (`settings/actions.ts`'s
 * `runScreenshotBatchRecategorization`), and its Settings-page trigger
 * once the 3 Sept 2026 real screenshot-import batch is fully recategorised
 * (`beforeUncategorized: 0` on a run means there's nothing left to do).
 *
 * Retroactively runs the Layer 4 (AI) categorisation added in commit
 * 6cdb7d1 against transactions from that batch that were created before
 * the AI layer existed and are therefore still uncategorised.
 * Re-uploading the same screenshots isn't usable for this because dedupe
 * would just match the existing rows and skip classification entirely —
 * this instead re-classifies the already-persisted rows in place.
 *
 * Deliberately narrow: only `SCREENSHOT_IMPORT` rows created inside the
 * fixed historical window below, belonging to the calling admin's own
 * household, and only where `categoryId` is still null and
 * `isUserOverridden` is false — a transaction with a confirmed category, a
 * household rule, or a learned mapping already has a non-null `categoryId`
 * and is excluded by this same filter, so it is never touched. Uses the
 * exact same `classifyTransactionBatch` (`@frodocodo/worker`) normal
 * ingestion calls for both provider sync and screenshot import — no
 * bespoke categorisation logic, and no screenshot/image bytes exist at
 * this stage to touch or resend (this operates purely on already-persisted
 * transaction rows).
 *
 * Triggered from Settings (admin-only, `requireAdmin()` in the calling
 * server action) rather than a token-gated API route — the household admin
 * is mobile-only and can tap a button in their already-logged-in session,
 * with no terminal, no curl, and no operational secret to copy anywhere.
 */

const BATCH_WINDOW_START = new Date("2026-09-03T08:00:00Z");
const BATCH_WINDOW_END = new Date("2026-09-03T09:00:00Z");

export interface RecategorizationSample {
  merchantName: string;
  categoryName: string | null;
  source: string | null;
  confidence: number | null;
}

export interface RecategorizationSummary {
  beforeUncategorized: number;
  deterministicResolved: number;
  transactionsSentToAi: number;
  uniqueMerchantsSentToAi: number;
  aiAutoAssigned: number;
  stillUnresolved: number;
  samples: RecategorizationSample[];
}

export async function recategorizeScreenshotImportBatch(householdId: string): Promise<RecategorizationSummary> {
  const candidates = await prisma.transaction.findMany({
    where: {
      account: { connection: { householdId } },
      sourceType: "SCREENSHOT_IMPORT",
      categoryId: null,
      isUserOverridden: false,
      createdAt: { gte: BATCH_WINDOW_START, lt: BATCH_WINDOW_END },
    },
    select: { id: true, originalDescription: true, amount: true, direction: true },
  });

  const beforeUncategorized = candidates.length;
  if (beforeUncategorized === 0) {
    return {
      beforeUncategorized: 0,
      deterministicResolved: 0,
      transactionsSentToAi: 0,
      uniqueMerchantsSentToAi: 0,
      aiAutoAssigned: 0,
      stillUnresolved: 0,
      samples: [],
    };
  }

  const extractor = getCategorySuggestionExtractor();
  const items = candidates.map((t) => ({
    key: t.id,
    originalDescription: t.originalDescription,
    amount: t.amount.toString(),
    direction: t.direction,
  }));

  const results = await classifyTransactionBatch(householdId, items, extractor);
  const categories = await prisma.category.findMany({ where: { householdId }, select: { id: true, name: true } });
  const categoryNameById = new Map(categories.map((c) => [c.id, c.name]));

  let deterministicResolved = 0;
  let aiAutoAssigned = 0;
  let stillUnresolved = 0;
  const merchantsSentToAi = new Set<string>();
  const sampleByMerchantId = new Map<string, RecategorizationSample>();

  for (const tx of candidates) {
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
      transactionsConsidered: candidates.length,
    },
  });

  return {
    beforeUncategorized,
    deterministicResolved,
    transactionsSentToAi: aiAutoAssigned + stillUnresolved,
    uniqueMerchantsSentToAi: merchantsSentToAi.size,
    aiAutoAssigned,
    stillUnresolved,
    samples: [...sampleByMerchantId.values()],
  };
}
