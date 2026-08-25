import { toMoney, sumMoney, ZERO, addDays, daysInMonth, parseCalendarDate, formatCalendarDate, isBefore, isAfter } from "@frodocodo/shared";
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
