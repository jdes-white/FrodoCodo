import "server-only";
import { formatAUD } from "@frodocodo/shared";
import { derivePaceStatusFromPacing } from "@frodocodo/domain";
import type { FinancialFactSheet } from "@frodocodo/ai";
import type { BudgetSnapshot } from "./budgetSnapshot";

/**
 * Converts the household's deterministic budget snapshot into the minimal
 * fact sheet the AI layer is allowed to see (§22) — every field here is
 * already a fact the app calculated; the model can only restate it.
 *
 * `status` is computed with the exact same `derivePaceStatusFromPacing`
 * (packages/domain/src/pacePosition.ts) that Home's bucket cards, the
 * bucket-detail page, and Insights' headline pill all call on these same
 * `snapshot.totalPacing`/`b.pacing` objects — so whatever the AI says
 * about a bucket's pace is guaranteed to be the same status the household
 * can see in the pill next to it, never a different classification
 * derived some other way.
 */
export function buildFactSheet(snapshot: BudgetSnapshot): FinancialFactSheet {
  return {
    budgetPeriod: {
      startDate: snapshot.period.startDate,
      endDate: snapshot.period.endDate,
      percentElapsed: Math.round(snapshot.totalPacing.percentPeriodElapsed),
    },
    totals: {
      allocation: formatAUD(snapshot.totalPacing.allocation),
      spent: formatAUD(snapshot.totalPacing.spentToDate),
      remaining: formatAUD(snapshot.totalPacing.remaining),
      status: derivePaceStatusFromPacing(snapshot.totalPacing),
      projectedEndOfPeriod: formatAUD(snapshot.totalPacing.projectedEndOfPeriod),
    },
    buckets: snapshot.buckets.map((b) => ({
      name: b.name,
      allocation: formatAUD(b.pacing.allocation),
      spent: formatAUD(b.pacing.spentToDate),
      remaining: formatAUD(b.pacing.remaining),
      status: derivePaceStatusFromPacing(b.pacing),
      projectedEndOfPeriod: formatAUD(b.pacing.projectedEndOfPeriod),
    })),
  };
}
