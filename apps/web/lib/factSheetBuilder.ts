import "server-only";
import { formatAUD } from "@frodocodo/shared";
import type { FinancialFactSheet } from "@frodocodo/ai";
import type { BudgetSnapshot } from "./budgetSnapshot";

/**
 * Converts the household's deterministic budget snapshot into the minimal
 * fact sheet the AI layer is allowed to see (§22) — every field here is
 * already a fact the app calculated; the model can only restate it.
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
      status: snapshot.totalPacing.pacingStatus,
      projectedEndOfPeriod: formatAUD(snapshot.totalPacing.projectedEndOfPeriod),
    },
    buckets: snapshot.buckets.map((b) => ({
      name: b.name,
      allocation: formatAUD(b.pacing.allocation),
      spent: formatAUD(b.pacing.spentToDate),
      remaining: formatAUD(b.pacing.remaining),
      status: b.pacing.pacingStatus,
      projectedEndOfPeriod: formatAUD(b.pacing.projectedEndOfPeriod),
    })),
  };
}
