/** "YYYY-MM" month identifiers used by the Transactions month filter (URL param). */

export function currentMonth(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function monthBounds(month: string): { startDate: string; endDate: string } {
  const [year, m] = month.split("-").map(Number);
  const start = new Date(Date.UTC(year!, m! - 1, 1));
  const end = new Date(Date.UTC(year!, m!, 0)); // day 0 of next month = last day of this month
  return { startDate: start.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10) };
}

export function shiftMonth(month: string, delta: number): string {
  const [year, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(year!, m! - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function monthLabel(month: string): string {
  const [year, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(year!, m! - 1, 1));
  return d.toLocaleDateString("en-AU", { month: "long", year: "numeric", timeZone: "UTC" });
}

/** True if `month` (YYYY-MM) is the current month or later — used to disable stepping into the future. */
export function isCurrentOrFutureMonth(month: string): boolean {
  return month >= currentMonth();
}
