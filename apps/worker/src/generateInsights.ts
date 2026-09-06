import { prisma } from "@frodocodo/db";
import { toMoney, todayUTC } from "@frodocodo/shared";
import {
  resolveBudgetPeriod,
  calculatePacing,
  detectProjectedOverspend,
  detectRecurringMerchants,
  recurringFindingsToInsights,
  type DetectedInsight,
} from "@frodocodo/domain";

/**
 * Persists deterministic insight-engine findings (§26) so they're available
 * without recomputing on every dashboard load. The web app also computes a
 * subset of these live (see apps/web/lib/insights.ts) so Insights is never
 * empty while waiting for this job to run — this persisted set is what
 * future notification delivery (§30) will read from.
 */
export async function generateInsightsForHousehold(householdId: string): Promise<number> {
  const household = await prisma.household.findUniqueOrThrow({ where: { id: householdId } });
  const asOf = todayUTC();
  const period = resolveBudgetPeriod(
    { type: household.defaultBudgetPeriodType, anchorDay: household.budgetAnchorDay ?? undefined },
    asOf,
  );
  const periodKey = `${period.startDate}_${period.endDate}`;

  const budgetPeriod = await prisma.budgetPeriod.findUnique({
    where: { householdId_startDate_endDate: { householdId, startDate: new Date(period.startDate), endDate: new Date(period.endDate) } },
    include: { allocations: { include: { category: { include: { bucket: true } } } } },
  });
  if (!budgetPeriod) return 0;

  const spendRows = await prisma.transaction.groupBy({
    by: ["categoryId"],
    where: { account: { connection: { householdId } }, isTransfer: false, isExcludedFromBudget: false, categoryId: { not: null } },
    _sum: { amount: true },
  });
  const spendByCategory = new Map(spendRows.map((r) => [r.categoryId!, toMoney(r._sum.amount?.toString() ?? "0")]));

  const bucketTotals = new Map<string, { name: string; allocation: ReturnType<typeof toMoney>; spent: ReturnType<typeof toMoney> }>();
  for (const alloc of budgetPeriod.allocations) {
    const bucket = alloc.category.bucket;
    const spent = spendByCategory.get(alloc.categoryId) ?? toMoney(0);
    const existing = bucketTotals.get(bucket.id);
    if (existing) {
      existing.allocation = existing.allocation.plus(alloc.amount.toString());
      existing.spent = existing.spent.plus(spent);
    } else {
      bucketTotals.set(bucket.id, { name: bucket.name, allocation: toMoney(alloc.amount.toString()), spent });
    }
  }

  const bucketPacings = [...bucketTotals.entries()].map(([bucketId, t]) => ({
    bucketId,
    bucketName: t.name,
    pacing: calculatePacing({ period, asOf, allocation: t.allocation, spentToDate: t.spent }),
  }));

  const findings: DetectedInsight[] = [...detectProjectedOverspend(bucketPacings, periodKey)];

  const merchantOccurrences = await prisma.transaction.findMany({
    // DEBIT only — recurring/subscription detection is about spending patterns;
    // income and refunds recurring at a regular cadence are not "subscriptions".
    where: { account: { connection: { householdId } }, normalizedMerchantId: { not: null }, isTransfer: false, direction: "DEBIT" },
    include: { merchant: true },
  });
  const recurring = detectRecurringMerchants(
    merchantOccurrences
      .filter((t) => t.merchant)
      .map((t) => ({
        transactionId: t.id,
        merchantMatchKey: t.merchant!.matchKey,
        merchantName: t.merchant!.normalizedName,
        amount: t.amount.toString(),
        transactionDate: t.transactionDate.toISOString().slice(0, 10),
      })),
  );
  findings.push(...recurringFindingsToInsights(recurring, periodKey));

  for (const finding of findings) {
    await prisma.insight.upsert({
      where: { householdId_dedupeKey: { householdId, dedupeKey: finding.dedupeKey } },
      update: { title: finding.title, summary: finding.summary, severity: finding.severity, generatedAt: new Date() },
      create: {
        householdId,
        budgetPeriodId: budgetPeriod.id,
        type: finding.type,
        severity: finding.severity,
        title: finding.title,
        summary: finding.summary,
        dedupeKey: finding.dedupeKey,
      },
    });
  }

  return findings.length;
}
