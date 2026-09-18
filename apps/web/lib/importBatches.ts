import "server-only";
import { prisma } from "@frodocodo/db";
import { classifyImportBatchOutcome, type ImportBatchOutcome, type ImportBatchOutcomeRow } from "@frodocodo/ledger";

/**
 * Screenshot-to-budget closure pass: reconstructs an import batch's result
 * entirely from the database, so it survives navigation, a page reload, or
 * closing and reopening the app — the previous result screen lived only in
 * a client component's `useState` and vanished the moment that component
 * unmounted (see `ImportScreenshotsForm.tsx`'s doc comment history).
 *
 * Deliberately does NOT store each transaction's outcome as its own
 * persisted field — only `ImportBatch` itself (counts for candidates that
 * never became a row: rejected screenshots, deduped-away candidates) is a
 * fixed historical fact. Every outcome that DID produce a `Transaction` row
 * (categorised, excluded as a non-spend movement, any kind of review flag)
 * is read live off that row's existing, already-authoritative columns via
 * `Transaction.importBatchId` — so a later recategorisation, a confirmed
 * duplicate, or a cleared review flag is reflected automatically the next
 * time this is called, without this module ever needing to reach back in
 * and update anything.
 */

export type { ImportBatchOutcome };

export interface ImportBatchSummary {
  id: string;
  createdAt: Date;
  screenshotsProcessed: number;
  screenshotsUnrecognized: number;
  sourcesDetected: string[];
  transactionsFound: number;
  /** Candidates that matched an existing transaction (or a sibling in the same upload) and were never inserted — there is no row to look up, so this count is the only record of them. */
  alreadyKnownCount: number;
  /** Rows the vision model saw but could not confidently structure at all — never inserted, so this count is the only record of them. */
  unreadableTransactionCount: number;
  /** Every transaction this batch DID create, bucketed by its current, live outcome. Sums to `transactionsFound - alreadyKnownCount`. */
  outcomeCounts: Record<ImportBatchOutcome, number>;
}

type OutcomeRow = ImportBatchOutcomeRow & { importBatchId: string | null };

const EMPTY_OUTCOME_COUNTS: Record<ImportBatchOutcome, number> = {
  CATEGORISED: 0,
  CATEGORY_REVIEW: 0,
  EXCLUDED_NON_SPEND: 0,
  FINANCIAL_MOVEMENT_REVIEW: 0,
  POSSIBLE_DUPLICATE: 0,
  LOW_CONFIDENCE_EXTRACTION: 0,
};

async function summarizeBatches(
  batches: Array<{
    id: string;
    createdAt: Date;
    screenshotsProcessed: number;
    screenshotsUnrecognized: number;
    sourcesDetected: unknown;
    transactionsFound: number;
    alreadyKnownCount: number;
    unreadableTransactionCount: number;
  }>,
): Promise<ImportBatchSummary[]> {
  if (batches.length === 0) return [];

  const rows = await prisma.transaction.findMany({
    where: { importBatchId: { in: batches.map((b) => b.id) } },
    select: {
      importBatchId: true,
      categoryId: true,
      isExcludedFromBudget: true,
      needsFinancialMovementReview: true,
      possibleDuplicateOfId: true,
      needsExtractionReview: true,
    },
  });

  const rowsByBatch = new Map<string, OutcomeRow[]>();
  for (const row of rows) {
    const list = rowsByBatch.get(row.importBatchId!) ?? [];
    list.push(row);
    rowsByBatch.set(row.importBatchId!, list);
  }

  return batches.map((batch) => {
    const outcomeCounts = { ...EMPTY_OUTCOME_COUNTS };
    for (const row of rowsByBatch.get(batch.id) ?? []) {
      outcomeCounts[classifyImportBatchOutcome(row)]++;
    }
    return {
      id: batch.id,
      createdAt: batch.createdAt,
      screenshotsProcessed: batch.screenshotsProcessed,
      screenshotsUnrecognized: batch.screenshotsUnrecognized,
      sourcesDetected: Array.isArray(batch.sourcesDetected) ? (batch.sourcesDetected as string[]) : [],
      transactionsFound: batch.transactionsFound,
      alreadyKnownCount: batch.alreadyKnownCount,
      unreadableTransactionCount: batch.unreadableTransactionCount,
      outcomeCounts,
    };
  });
}

export async function getRecentImportBatches(householdId: string, limit = 5): Promise<ImportBatchSummary[]> {
  const batches = await prisma.importBatch.findMany({
    where: { householdId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return summarizeBatches(batches);
}

export async function getImportBatch(householdId: string, importBatchId: string): Promise<ImportBatchSummary | null> {
  const batch = await prisma.importBatch.findFirst({ where: { id: importBatchId, householdId } });
  if (!batch) return null;
  const [summary] = await summarizeBatches([batch]);
  return summary ?? null;
}
