import { toMoney, ZERO, clampMin, percentage, type Money } from "@frodocodo/shared";
import type { PacingStatus, SpendingType } from "@frodocodo/shared";
import { daysBetween, parseCalendarDate, formatCalendarDate, type CalendarDate } from "./dateOnly.js";
import type { BudgetPeriodBounds } from "./budgetPeriod.js";

export interface PacingInput {
  period: BudgetPeriodBounds;
  asOf: CalendarDate;
  allocation: Money;
  spentToDate: Money;
  spendingType?: SpendingType;
  /** Day-of-month a FIXED_COMMITMENT is expected to post; drives a step (not linear) expected curve. */
  fixedDueDayOfMonth?: number;
  /** Spend within the trailing window, used for velocity. Falls back to a to-date average when omitted. */
  trailingSpend?: Money;
  trailingWindowDays?: number;
  /** Fraction of allocation within which spend-vs-expected is considered "on track" (default 5%). */
  varianceThresholdRatio?: number;
}

export interface PacingResult {
  allocation: Money;
  spentToDate: Money;
  remaining: Money;
  percentConsumed: number;
  percentPeriodElapsed: number;
  daysElapsed: number;
  daysRemaining: number;
  totalDays: number;
  expectedSpendToDate: Money;
  /** spentToDate - expectedSpendToDate. Positive = spending ahead of expected pace (bad). */
  variance: Money;
  pacingStatus: PacingStatus;
  spendVelocityPerDay: Money;
  projectedEndOfPeriod: Money;
  /** projectedEndOfPeriod - allocation. Positive = projected overspend. */
  projectedVariance: Money;
}

const DEFAULT_VARIANCE_THRESHOLD_RATIO = 0.05;
const DEFAULT_TRAILING_WINDOW_DAYS = 7;

export function calculatePacing(input: PacingInput): PacingResult {
  const { period, asOf } = input;
  const allocation = toMoney(input.allocation);
  const spentToDate = toMoney(input.spentToDate);
  const spendingType = input.spendingType ?? "FLEXIBLE";
  const varianceThresholdRatio = input.varianceThresholdRatio ?? DEFAULT_VARIANCE_THRESHOLD_RATIO;

  const totalDays = daysBetween(period.startDate, period.endDate) + 1;
  const rawElapsed = daysBetween(period.startDate, asOf) + 1;
  const daysElapsed = Math.min(Math.max(rawElapsed, 0), totalDays);
  const daysRemaining = totalDays - daysElapsed;
  const percentPeriodElapsed = totalDays === 0 ? 100 : (daysElapsed / totalDays) * 100;

  const expectedSpendToDate =
    spendingType === "FIXED_COMMITMENT" && input.fixedDueDayOfMonth
      ? fixedCommitmentExpectedSpend(period, asOf, input.fixedDueDayOfMonth, allocation)
      : allocation.times(daysElapsed).dividedBy(totalDays || 1);

  const variance = spentToDate.minus(expectedSpendToDate);

  const thresholdAmount = allocation.times(varianceThresholdRatio).abs();
  let pacingStatus: PacingStatus = "ON_TRACK";
  if (variance.greaterThan(thresholdAmount)) pacingStatus = "BEHIND";
  else if (variance.lessThan(thresholdAmount.negated())) pacingStatus = "AHEAD";

  const trailingWindowDays = input.trailingWindowDays ?? DEFAULT_TRAILING_WINDOW_DAYS;
  const spendVelocityPerDay = input.trailingSpend
    ? toMoney(input.trailingSpend).dividedBy(trailingWindowDays)
    : daysElapsed > 0
      ? spentToDate.dividedBy(daysElapsed)
      : ZERO;

  const projectedEndOfPeriod =
    spendingType === "FIXED_COMMITMENT"
      ? spentToDate.greaterThan(allocation)
        ? spentToDate
        : allocation
      : spentToDate.plus(spendVelocityPerDay.times(daysRemaining));

  const projectedVariance = projectedEndOfPeriod.minus(allocation);

  return {
    allocation,
    spentToDate,
    remaining: clampMin(allocation.minus(spentToDate), ZERO.minus(allocation.abs())),
    percentConsumed: percentage(spentToDate, allocation),
    percentPeriodElapsed,
    daysElapsed,
    daysRemaining,
    totalDays,
    expectedSpendToDate,
    variance,
    pacingStatus,
    spendVelocityPerDay,
    projectedEndOfPeriod,
    projectedVariance,
  };
}

/**
 * Fixed commitments (rent, insurance, subscriptions) don't spend linearly —
 * they post in full on a known day. Expected-to-date is a step function:
 * 0 before the due date, the full allocation on/after it.
 */
function fixedCommitmentExpectedSpend(
  period: BudgetPeriodBounds,
  asOf: CalendarDate,
  dueDayOfMonth: number,
  allocation: Money,
): Money {
  const start = parseCalendarDate(period.startDate);
  const candidateDay = Math.min(dueDayOfMonth, daysInMonthOf(start));
  const dueDate = formatCalendarDate(
    new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), candidateDay)),
  );
  const due = daysBetween(period.startDate, dueDate) >= 0 && daysBetween(dueDate, period.endDate) >= 0
    ? dueDate
    : period.startDate;
  return daysBetween(due, asOf) >= 0 ? allocation : ZERO;
}

function daysInMonthOf(date: Date): number {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
}
