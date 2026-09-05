/**
 * Screenshot-to-budget closure pass: the pure bucketing rule
 * `apps/web/lib/importBatches.ts` uses to reconstruct what happened to each
 * transaction an import batch created, purely from that transaction's
 * already-authoritative columns — no separate "outcome" is ever persisted
 * per row, so a later recategorisation or review confirmation is reflected
 * automatically the next time a batch is reconstructed. Kept here, not in
 * `apps/web/lib`, so the actual bucketing decision is unit-testable with
 * plain objects (this package's convention — no database, no Next.js).
 */

export type ImportBatchOutcome =
  | "CATEGORISED"
  | "CATEGORY_REVIEW"
  | "EXCLUDED_NON_SPEND"
  | "FINANCIAL_MOVEMENT_REVIEW"
  | "POSSIBLE_DUPLICATE"
  | "LOW_CONFIDENCE_EXTRACTION";

export interface ImportBatchOutcomeRow {
  categoryId: string | null;
  isExcludedFromBudget: boolean;
  needsFinancialMovementReview: boolean;
  possibleDuplicateOfId: string | null;
  needsExtractionReview: boolean;
}

/**
 * A row can technically satisfy more than one condition at once (e.g. a
 * possible duplicate the vision model also wasn't confident about) — this
 * picks exactly one bucket per row, most-fundamental-uncertainty first, so
 * a batch summary's counts sum cleanly to its created-row count. This
 * ordering is only about which single label a batch *summary* shows first;
 * it does not change how the transaction itself behaves — the review queue
 * (`apps/web/lib/transactions.ts`'s `needsReviewOnly`) still surfaces it via
 * an OR across every flag it actually carries.
 */
export function classifyImportBatchOutcome(row: ImportBatchOutcomeRow): ImportBatchOutcome {
  if (row.needsExtractionReview) return "LOW_CONFIDENCE_EXTRACTION";
  if (row.possibleDuplicateOfId) return "POSSIBLE_DUPLICATE";
  if (row.needsFinancialMovementReview) return "FINANCIAL_MOVEMENT_REVIEW";
  if (row.isExcludedFromBudget) return "EXCLUDED_NON_SPEND";
  if (row.categoryId) return "CATEGORISED";
  return "CATEGORY_REVIEW";
}
