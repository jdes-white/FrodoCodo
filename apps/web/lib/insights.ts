import "server-only";
import { prisma } from "@frodocodo/db";
import { addDays, toMoney } from "@frodocodo/shared";
import {
  detectProjectedOverspend,
  detectUnusualCategoryIncrease,
  type DetectedInsight,
} from "@frodocodo/domain";
import { getBudgetSnapshot, type BudgetSnapshot } from "./budgetSnapshot";
import { fromPrismaDecimal } from "./decimal";

/**
 * Runs the deterministic insight engine (§26) live against the current
 * snapshot. A background worker can persist these to the Insight table on a
 * schedule (see apps/worker) — computing live here as well means Insights
 * is always populated in dev/demo without depending on that job having run.
 */
export async function getLiveInsights(householdId: string): Promise<DetectedInsight[]> {
  const snapshot = await getBudgetSnapshot(householdId);
  const periodKey = `${snapshot.period.startDate}_${snapshot.period.endDate}`;

  const overspend = detectProjectedOverspend(
    snapshot.buckets.map((b) => ({ bucketId: b.bucketId, bucketName: b.name, pacing: b.pacing })),
    periodKey,
  );

  const categoryIncrease = await detectCategoryIncreaseInsights(householdId, snapshot, periodKey);

  return [...overspend, ...categoryIncrease].sort((a, b) => severityRank(b) - severityRank(a));
}

async function detectCategoryIncreaseInsights(
  householdId: string,
  snapshot: BudgetSnapshot,
  periodKey: string,
): Promise<DetectedInsight[]> {
  const priorStart = addDays(snapshot.period.startDate, -daysInPeriod(snapshot));
  const priorEnd = addDays(snapshot.period.startDate, -1);

  const priorRows = await prisma.transaction.groupBy({
    by: ["categoryId"],
    where: {
      account: { connection: { householdId } },
      transactionDate: { gte: new Date(priorStart), lte: new Date(priorEnd) },
      isTransfer: false,
      isExcludedFromBudget: false,
      direction: "DEBIT",
      categoryId: { not: null },
    },
    _sum: { amount: true },
  });
  const priorByCategory = new Map(priorRows.map((r) => [r.categoryId!, fromPrismaDecimal(r._sum.amount)]));

  const categories = snapshot.buckets.flatMap((b) => b.categories);
  const inputs = categories.map((c) => ({
    categoryId: c.categoryId,
    categoryName: c.name,
    currentTotal: c.pacing.spentToDate,
    priorTotal: priorByCategory.get(c.categoryId) ?? toMoney(0),
  }));

  return detectUnusualCategoryIncrease(inputs, periodKey);
}

function daysInPeriod(snapshot: BudgetSnapshot): number {
  return snapshot.totalPacing.totalDays;
}

function severityRank(insight: DetectedInsight): number {
  if (insight.severity === "WARNING") return 2;
  if (insight.severity === "NOTICE") return 1;
  return 0;
}
