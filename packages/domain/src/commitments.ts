import { toMoney, sumMoney, ZERO, addDays, daysBetween, daysInMonth, parseCalendarDate, formatCalendarDate, isBefore, isAfter } from "@frodocodo/shared";
import type { Money, MoneyInput, CalendarDate } from "@frodocodo/shared";
import type { BudgetPeriodBounds } from "./budgetPeriod.js";

export type CommitmentRecurrence = "WEEKLY" | "FORTNIGHTLY" | "MONTHLY";

export interface CommitmentLike {
  amount: MoneyInput;
  expectedDate: CalendarDate;
  completedAt: string | Date | null;
}

/**
 * Upcoming Commitments V1 (§1-4 of the spec): a manually-tracked known bill
 * counts toward "how much is already spoken for this period" only while
 * it's both unpaid and its expected date falls inside the current budget
 * period — a completed one stops counting immediately, and a future
 * commitment outside this period stays stored but inert until it rolls
 * into range.
 */
export function isCommitmentDueInPeriod(commitment: CommitmentLike, period: BudgetPeriodBounds): boolean {
  if (commitment.completedAt) return false;
  if (isBefore(commitment.expectedDate, period.startDate)) return false;
  if (isAfter(commitment.expectedDate, period.endDate)) return false;
  return true;
}

export interface CommitmentsSummary {
  /** Sum of every due-this-period, not-yet-completed commitment. */
  committed: Money;
  /** remaining − committed. Can be negative — callers should branch on
   * `isShortfall` rather than ever displaying this value directly when
   * negative (the product spec explicitly avoids a "-$464 uncommitted"
   * reading in favour of a distinct shortfall message). */
  uncommitted: Money;
  isShortfall: boolean;
  /** abs(uncommitted) when isShortfall, otherwise zero. */
  shortfall: Money;
}

/** Pure §2 calculation: uncommitted = remaining − upcoming commitments due this period. */
export function summarizeCommitments(remaining: MoneyInput, dueCommitments: CommitmentLike[]): CommitmentsSummary {
  const committed = sumMoney(dueCommitments.map((c) => toMoney(c.amount)));
  const uncommitted = toMoney(remaining).minus(committed);
  const isShortfall = uncommitted.isNegative();
  return {
    committed,
    uncommitted,
    isShortfall,
    shortfall: isShortfall ? uncommitted.abs() : ZERO,
  };
}

/**
 * The Home Page 2 bucket-card integration's rolling look-ahead (distinct
 * from `isCommitmentDueInPeriod`'s budget-period window, which follows
 * calendar-month/fortnightly boundaries): "due within N days from today",
 * always exactly N days regardless of where the household's budget period
 * happens to end. A commitment due today (daysUntil 0) counts; the
 * category-must-be-chosen-explicitly rule lives in the caller, not here —
 * this function only cares about dates.
 */
export function isCommitmentDueWithinWindow(commitment: CommitmentLike, asOf: CalendarDate, windowDays: number): boolean {
  if (commitment.completedAt) return false;
  if (isBefore(commitment.expectedDate, asOf)) return false;
  return daysBetween(asOf, commitment.expectedDate) <= windowDays;
}

/** Sorted soonest-first — the order the expanded per-bucket view (and any other N-day list) should render in. */
export function commitmentsDueWithinWindow<T extends CommitmentLike>(commitments: T[], asOf: CalendarDate, windowDays: number): T[] {
  return commitments
    .filter((c) => isCommitmentDueWithinWindow(c, asOf, windowDays))
    .sort((a, b) => a.expectedDate.localeCompare(b.expectedDate));
}

export interface UpcomingWindowSummary {
  /** Sum of every item passed in — callers pass only already-window-filtered items. */
  total: Money;
  count: number;
  /**
   * The non-amount half of the compact bucket-card line, e.g. "due
   * tomorrow" / "due in 4 days" / "due in the next 7 days" — callers
   * prefix this with their own formatted `total` (money formatting is a
   * web/shared concern, not a domain one). Null when `count` is 0, since
   * there's nothing to say.
   */
  phrase: string | null;
}

/**
 * Smart time-based wording (per the Upcoming Commitments Home-integration
 * spec): a single commitment gets its own specific date language ("due
 * tomorrow", "due in 4 days"), while two or more collapse to the window
 * boundary ("due in the next 7 days") rather than trying to describe
 * several different dates in one line. A single item that lands exactly on
 * the window's edge also uses the boundary phrasing (matching the spec's
 * worked examples) rather than "due in 7 days".
 */
export function summarizeUpcomingWindow(dueItems: CommitmentLike[], asOf: CalendarDate, windowDays: number): UpcomingWindowSummary {
  if (dueItems.length === 0) return { total: ZERO, count: 0, phrase: null };

  const total = sumMoney(dueItems.map((c) => toMoney(c.amount)));

  if (dueItems.length === 1) {
    const daysUntil = daysBetween(asOf, dueItems[0]!.expectedDate);
    const phrase =
      daysUntil <= 0
        ? "due today"
        : daysUntil === 1
          ? "due tomorrow"
          : daysUntil < windowDays
            ? `due in ${daysUntil} days`
            : `due in the next ${windowDays} days`;
    return { total, count: 1, phrase };
  }

  return { total, count: dueItems.length, phrase: `due in the next ${windowDays} days` };
}

/**
 * Cheap manual recurrence (§5): advances a just-completed commitment's date
 * by its chosen cadence so the household doesn't have to re-enter an
 * obvious repeat like a mortgage. Not pattern detection — the caller
 * decides when to invoke this (on mark-complete), and it produces exactly
 * one new date, nothing more. Monthly preserves day-of-month, clamping into
 * shorter months the same way BudgetPeriod's anchored-monthly cycle already
 * does (e.g. 31 Jan -> 28/29 Feb) rather than overflowing into the month
 * after.
 */
export function nextRecurrenceDate(expectedDate: CalendarDate, recurrence: CommitmentRecurrence): CalendarDate {
  switch (recurrence) {
    case "WEEKLY":
      return addDays(expectedDate, 7);
    case "FORTNIGHTLY":
      return addDays(expectedDate, 14);
    case "MONTHLY":
      return addOneCalendarMonth(expectedDate);
    default:
      throw new Error(`Unsupported commitment recurrence: ${recurrence satisfies never}`);
  }
}

function addOneCalendarMonth(value: CalendarDate): CalendarDate {
  const d = parseCalendarDate(value);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth();
  const day = d.getUTCDate();

  let nextMonth = month + 1;
  let nextYear = year;
  if (nextMonth > 11) {
    nextMonth = 0;
    nextYear += 1;
  }
  const clampedDay = Math.min(day, daysInMonth(nextYear, nextMonth));
  return formatCalendarDate(new Date(Date.UTC(nextYear, nextMonth, clampedDay)));
}
