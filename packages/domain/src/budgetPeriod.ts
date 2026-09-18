import type { BudgetPeriodType } from "@frodocodo/shared";
import {
  addDays,
  daysBetween,
  daysInMonth,
  formatCalendarDate,
  parseCalendarDate,
  type CalendarDate,
} from "@frodocodo/shared";

export interface BudgetPeriodBounds {
  startDate: CalendarDate;
  endDate: CalendarDate; // inclusive
}

export interface BudgetCycleConfig {
  type: BudgetPeriodType;
  /** Day-of-month (1-28) the cycle anchors to. Required for ANCHORED_MONTHLY. */
  anchorDay?: number;
  /** Cycle start reference point. Required for FORTNIGHTLY and CUSTOM. */
  epoch?: CalendarDate;
  /** Cycle length in days. Required for CUSTOM. */
  lengthDays?: number;
}

/**
 * Resolves the budget period that contains `referenceDate` for a given
 * household cycle configuration. Support for non-calendar-month cycles
 * (§15) exists because household income often doesn't arrive on the 1st.
 */
export function resolveBudgetPeriod(
  config: BudgetCycleConfig,
  referenceDate: CalendarDate,
): BudgetPeriodBounds {
  switch (config.type) {
    case "CALENDAR_MONTH":
      return calendarMonthPeriod(referenceDate);
    case "ANCHORED_MONTHLY":
      if (!config.anchorDay) throw new Error("ANCHORED_MONTHLY requires anchorDay");
      return anchoredMonthlyPeriod(referenceDate, config.anchorDay);
    case "FORTNIGHTLY":
      if (!config.epoch) throw new Error("FORTNIGHTLY requires epoch");
      return recurringPeriod(referenceDate, config.epoch, 14);
    case "CUSTOM":
      if (!config.epoch || !config.lengthDays) {
        throw new Error("CUSTOM requires epoch and lengthDays");
      }
      return recurringPeriod(referenceDate, config.epoch, config.lengthDays);
    default:
      throw new Error(`Unsupported budget period type: ${config.type satisfies never}`);
  }
}

function calendarMonthPeriod(referenceDate: CalendarDate): BudgetPeriodBounds {
  const d = parseCalendarDate(referenceDate);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth();
  const start = formatCalendarDate(new Date(Date.UTC(year, month, 1)));
  const end = formatCalendarDate(new Date(Date.UTC(year, month, daysInMonth(year, month))));
  return { startDate: start, endDate: end };
}

function anchoredMonthlyPeriod(referenceDate: CalendarDate, anchorDay: number): BudgetPeriodBounds {
  const d = parseCalendarDate(referenceDate);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth();
  const dayOfMonth = d.getUTCDate();

  const thisMonthAnchor = Math.min(anchorDay, daysInMonth(year, month));
  let startYear = year;
  let startMonth = month;

  if (dayOfMonth < thisMonthAnchor) {
    startMonth -= 1;
    if (startMonth < 0) {
      startMonth = 11;
      startYear -= 1;
    }
  }

  const startDay = Math.min(anchorDay, daysInMonth(startYear, startMonth));
  const startDate = formatCalendarDate(new Date(Date.UTC(startYear, startMonth, startDay)));
  const endDate = addDays(
    (() => {
      let endMonth = startMonth + 1;
      let endYear = startYear;
      if (endMonth > 11) {
        endMonth = 0;
        endYear += 1;
      }
      const endAnchorDay = Math.min(anchorDay, daysInMonth(endYear, endMonth));
      return formatCalendarDate(new Date(Date.UTC(endYear, endMonth, endAnchorDay)));
    })(),
    -1,
  );

  return { startDate, endDate };
}

function recurringPeriod(
  referenceDate: CalendarDate,
  epoch: CalendarDate,
  lengthDays: number,
): BudgetPeriodBounds {
  const offset = daysBetween(epoch, referenceDate);
  const cycleIndex = Math.floor(offset / lengthDays);
  const startDate = addDays(epoch, cycleIndex * lengthDays);
  const endDate = addDays(startDate, lengthDays - 1);
  return { startDate, endDate };
}
