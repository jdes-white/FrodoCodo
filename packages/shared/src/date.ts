/**
 * Calendar-date-only arithmetic (no time-of-day, no local-timezone drift).
 * Budget periods and provider sync windows are defined in whole
 * household-local days, so every calculation here operates on "YYYY-MM-DD"
 * strings via UTC-midnight Dates — local Date arithmetic would shift period
 * boundaries across DST changes.
 */
export type CalendarDate = string; // "YYYY-MM-DD"

export function parseCalendarDate(value: CalendarDate): Date {
  const parts = value.split("-").map(Number);
  const [y, m, d] = [parts[0]!, parts[1]!, parts[2]!];
  return new Date(Date.UTC(y, m - 1, d));
}

export function formatCalendarDate(date: Date): CalendarDate {
  return date.toISOString().slice(0, 10);
}

export function addDays(value: CalendarDate, days: number): CalendarDate {
  const date = parseCalendarDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return formatCalendarDate(date);
}

export function daysBetween(from: CalendarDate, to: CalendarDate): number {
  const a = parseCalendarDate(from).getTime();
  const b = parseCalendarDate(to).getTime();
  return Math.round((b - a) / 86_400_000);
}

export function clampDate(value: CalendarDate, min: CalendarDate, max: CalendarDate): CalendarDate {
  if (daysBetween(min, value) < 0) return min;
  if (daysBetween(value, max) < 0) return max;
  return value;
}

export function isBefore(a: CalendarDate, b: CalendarDate): boolean {
  return daysBetween(b, a) < 0;
}

export function isAfter(a: CalendarDate, b: CalendarDate): boolean {
  return daysBetween(b, a) > 0;
}

export function daysInMonth(year: number, monthIndex0: number): number {
  return new Date(Date.UTC(year, monthIndex0 + 1, 0)).getUTCDate();
}

export function todayUTC(): CalendarDate {
  return formatCalendarDate(new Date());
}
