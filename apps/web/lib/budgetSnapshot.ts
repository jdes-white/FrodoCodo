import "server-only";
import { prisma } from "@frodocodo/db";
import { toMoney, sumMoney, percentage, addDays, todayUTC, type Money, type SpendingType } from "@frodocodo/shared";
import { resolveBudgetPeriod, calculatePacing, type PacingResult, type BudgetPeriodBounds } from "@frodocodo/domain";
import { fromPrismaDecimal } from "./decimal";

export interface CategorySnapshot {
  categoryId: string;
  name: string;
  bucketId: string;
  spendingType: SpendingType;
  pacing: PacingResult;
}

export interface FlexibleBudgetSnapshot {
  allocation: Money;
  spentToDate: Money;
  percentConsumed: number;
  /** Recurring-aware expected-to-date (Stage 2 aggregation, same pattern as
   * totalPacing/bucket pacing below) — linear when no flexible category has
   * a smarter model, but wired through calculatePacing so it automatically
   * benefits if one ever does. Drives Home's pacing-ring expected-position
   * marker (see components/PacingRing.tsx). */
  expectedSpendToDate: Money;
}

export interface BucketSnapshot {
  bucketId: string;
  name: string;
  colorToken: string;
  pacing: PacingResult;
  categories: CategorySnapshot[];
}

export interface BudgetSnapshot {
  period: BudgetPeriodBounds;
  budgetPeriodId: string;
  asOf: string;
  totalPacing: PacingResult;
  /** Same period, but scoped to FLEXIBLE-spendingType categories only — fixed
   * commitments and savings transfers excluded, since neither is "spending"
   * in the variable/discretionary sense a pace explanation is talking about. */
  flexibleBudget: FlexibleBudgetSnapshot;
  buckets: BucketSnapshot[];
  lastSyncedAt: Date | null;
  staleSyncAccountNames: string[];
}

const TRAILING_WINDOW_DAYS = 7;
const STALE_SYNC_HOURS = 36;

/**
 * The single source of truth the dashboard, Plan page, bucket detail, and
 * the AI fact sheet all build from — computed fresh from the ledger and the
 * deterministic domain engine, never cached in a way that could drift from
 * the underlying transactions (§43 talks about caching, but correctness
 * comes first; this is the place to add memoization later without touching
 * any caller).
 */
export async function getBudgetSnapshot(householdId: string, asOf: string = todayUTC()): Promise<BudgetSnapshot> {
  const household = await prisma.household.findUniqueOrThrow({ where: { id: householdId } });

  const period = resolveBudgetPeriod(
    {
      type: household.defaultBudgetPeriodType,
      anchorDay: household.budgetAnchorDay ?? undefined,
    },
    asOf,
  );

  const budgetPeriod = await ensureBudgetPeriod(householdId, period);

  const allocations = await prisma.budgetAllocation.findMany({
    where: { budgetPeriodId: budgetPeriod.id },
    include: { category: { include: { bucket: true } } },
  });

  const trailingSince = addDays(asOf, -TRAILING_WINDOW_DAYS);

  const [periodTotals, trailingTotals, fixedCommitments, accounts] = await Promise.all([
    netSpendByCategory(householdId, period.startDate, period.endDate),
    netSpendByCategory(householdId, trailingSince, asOf),
    prisma.fixedCommitment.findMany({ where: { householdId, isActive: true } }),
    prisma.account.findMany({ where: { connection: { householdId } }, select: { lastSyncedAt: true, displayName: true } }),
  ]);

  const fixedByCategory = new Map(fixedCommitments.map((f) => [f.categoryId, f]));

  const bucketMap = new Map<string, BucketSnapshot>();

  for (const allocation of allocations) {
    const category = allocation.category;
    const bucket = category.bucket;
    const spent = periodTotals.get(category.id) ?? toMoney(0);
    const trailing = trailingTotals.get(category.id) ?? toMoney(0);
    const fixedCommitment = fixedByCategory.get(category.id);

    const pacing = calculatePacing({
      period,
      asOf,
      allocation: fromPrismaDecimal(allocation.amount),
      spentToDate: spent,
      spendingType: category.spendingType,
      fixedDueDayOfMonth: fixedCommitment?.expectedDueDayOfMonth ?? undefined,
      trailingSpend: trailing,
      trailingWindowDays: TRAILING_WINDOW_DAYS,
    });

    const categorySnapshot: CategorySnapshot = {
      categoryId: category.id,
      name: category.name,
      bucketId: bucket.id,
      spendingType: category.spendingType,
      pacing,
    };

    const existing = bucketMap.get(bucket.id);
    if (existing) {
      existing.categories.push(categorySnapshot);
    } else {
      bucketMap.set(bucket.id, {
        bucketId: bucket.id,
        name: bucket.name,
        colorToken: bucket.colorToken,
        pacing, // placeholder, replaced below once all categories are collected
        categories: [categorySnapshot],
      });
    }
  }

  const buckets: BucketSnapshot[] = [...bucketMap.values()]
    .map((bucket) => {
      const totalAllocation = sumMoney(bucket.categories.map((c) => c.pacing.allocation));
      const totalSpent = sumMoney(bucket.categories.map((c) => c.pacing.spentToDate));
      const totalTrailing = sumMoney(
        bucket.categories.map((c) => c.pacing.spendVelocityPerDay.times(TRAILING_WINDOW_DAYS)),
      );
      // Recurring-aware aggregation (pacing Stage 2, see PacingInput's
      // expectedSpendToDateOverride doc comment): sum each category's own
      // already-correct expected-to-date (step-at-due-date for a fixed
      // commitment, linear for flexible spend) instead of re-deriving one
      // flat linear expectation from the bucket's combined allocation. A
      // bucket containing a mortgage due on day 3 would otherwise look like
      // it's wildly overspending the moment that single payment posts.
      const expectedSpendToDateOverride = sumMoney(bucket.categories.map((c) => c.pacing.expectedSpendToDate));
      const pacing = calculatePacing({
        period,
        asOf,
        allocation: totalAllocation,
        spentToDate: totalSpent,
        trailingSpend: totalTrailing,
        trailingWindowDays: TRAILING_WINDOW_DAYS,
        expectedSpendToDateOverride,
      });
      return { ...bucket, pacing };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const totalAllocation = sumMoney(buckets.map((b) => b.pacing.allocation));
  const totalSpent = sumMoney(buckets.map((b) => b.pacing.spentToDate));
  const totalTrailing = sumMoney(buckets.map((b) => b.pacing.spendVelocityPerDay.times(TRAILING_WINDOW_DAYS)));
  const totalExpectedSpendToDateOverride = sumMoney(buckets.map((b) => b.pacing.expectedSpendToDate));
  const totalPacing = calculatePacing({
    period,
    asOf,
    allocation: totalAllocation,
    spentToDate: totalSpent,
    trailingSpend: totalTrailing,
    trailingWindowDays: TRAILING_WINDOW_DAYS,
    expectedSpendToDateOverride: totalExpectedSpendToDateOverride,
  });

  const flexibleCategories = [...bucketMap.values()].flatMap((b) => b.categories).filter((c) => c.spendingType === "FLEXIBLE");
  const flexibleAllocation = sumMoney(flexibleCategories.map((c) => c.pacing.allocation));
  const flexibleSpent = sumMoney(flexibleCategories.map((c) => c.pacing.spentToDate));
  // Same recurring-aware aggregation as the bucket/total pacing above,
  // scoped to flexible categories only — every category here is already
  // FLEXIBLE (linear expected-to-date today, since only FIXED_COMMITMENT
  // gets step-function treatment), but routing through calculatePacing
  // rather than hand-deriving elapsed-time % keeps this correct
  // automatically if flexible categories ever get smarter pacing too.
  const flexibleExpectedOverride = sumMoney(flexibleCategories.map((c) => c.pacing.expectedSpendToDate));
  const flexiblePacing = calculatePacing({
    period,
    asOf,
    allocation: flexibleAllocation,
    spentToDate: flexibleSpent,
    expectedSpendToDateOverride: flexibleExpectedOverride,
  });
  const flexibleBudget: FlexibleBudgetSnapshot = {
    allocation: flexibleAllocation,
    spentToDate: flexibleSpent,
    percentConsumed: percentage(flexibleSpent, flexibleAllocation),
    expectedSpendToDate: flexiblePacing.expectedSpendToDate,
  };

  const lastSyncedAt = accounts.reduce<Date | null>((latest, a) => {
    if (!a.lastSyncedAt) return latest;
    if (!latest || a.lastSyncedAt > latest) return a.lastSyncedAt;
    return latest;
  }, null);

  const staleCutoff = new Date(Date.now() - STALE_SYNC_HOURS * 60 * 60 * 1000);
  const staleSyncAccountNames = accounts
    .filter((a) => !a.lastSyncedAt || a.lastSyncedAt < staleCutoff)
    .map((a) => a.displayName);

  return { period, budgetPeriodId: budgetPeriod.id, asOf, totalPacing, flexibleBudget, buckets, lastSyncedAt, staleSyncAccountNames };
}

/** Nets DEBIT spend against CREDIT (refunds) per category, excluding transfers and excluded transactions (§39). */
async function netSpendByCategory(householdId: string, startDate: string, endDate: string): Promise<Map<string, Money>> {
  const rows = await prisma.transaction.groupBy({
    by: ["categoryId", "direction"],
    where: {
      account: { connection: { householdId } },
      transactionDate: { gte: new Date(startDate), lte: new Date(endDate) },
      isTransfer: false,
      isExcludedFromBudget: false,
      categoryId: { not: null },
    },
    _sum: { amount: true },
  });

  const totals = new Map<string, Money>();
  for (const row of rows) {
    if (!row.categoryId) continue;
    const signedAmount = row.direction === "DEBIT" ? fromPrismaDecimal(row._sum.amount) : fromPrismaDecimal(row._sum.amount).negated();
    const existing = totals.get(row.categoryId) ?? toMoney(0);
    totals.set(row.categoryId, existing.plus(signedAmount));
  }
  return totals;
}

/**
 * First visit to a new period auto-creates it by rolling over the most
 * recent prior period's allocations — the household shouldn't have to
 * rebuild its budget every cycle (§28, "ongoing usage should not [require
 * effort]").
 */
async function ensureBudgetPeriod(householdId: string, period: BudgetPeriodBounds) {
  const existing = await prisma.budgetPeriod.findUnique({
    where: { householdId_startDate_endDate: { householdId, startDate: new Date(period.startDate), endDate: new Date(period.endDate) } },
  });
  if (existing) return existing;

  const priorPeriod = await prisma.budgetPeriod.findFirst({
    where: { householdId },
    orderBy: { startDate: "desc" },
    include: { allocations: true },
  });

  return prisma.budgetPeriod.create({
    data: {
      householdId,
      type: priorPeriod?.type ?? "CALENDAR_MONTH",
      startDate: new Date(period.startDate),
      endDate: new Date(period.endDate),
      expectedIncome: priorPeriod?.expectedIncome ?? 0,
      bufferAmount: priorPeriod?.bufferAmount ?? 0,
      allocations: priorPeriod
        ? { create: priorPeriod.allocations.map((a) => ({ categoryId: a.categoryId, amount: a.amount })) }
        : undefined,
    },
  });
}
