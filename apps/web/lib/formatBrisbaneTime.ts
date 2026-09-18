/**
 * Presentation-only Brisbane-local timestamp formatting (screenshot-to-budget
 * closure pass, production defect: import timestamps rendered in the
 * server process's own timezone — whatever Render's container runs as, not
 * the household's — because `toLocaleString` with no explicit `timeZone`
 * uses the runtime's ambient default). Stored timestamps are correct UTC;
 * only how they're displayed was wrong, so nothing here touches persisted
 * data.
 *
 * FrodoCodo has exactly one household timezone in practice
 * (`Household.timezone`, defaulted to `"Australia/Brisbane"`) and no
 * multi-timezone household exists yet, so this is hardcoded rather than
 * threaded through as a parameter. `Australia/Brisbane` never observes
 * daylight saving (fixed UTC+10 year-round) — there is no DST transition
 * for this to get wrong.
 */
export function formatBrisbaneTime(date: Date): string {
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Brisbane",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}
