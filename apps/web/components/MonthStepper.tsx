import Link from "next/link";
import { monthLabel, shiftMonth, isCurrentOrFutureMonth } from "@/lib/monthRange";
import { Card } from "./Card";

/**
 * Prev/next month navigation, built as plain links (not a <select> or a
 * client-side JS control) so it works via ordinary server-rendered
 * navigation and preserves whatever other filters (category, account,
 * merchant, needs-review) are already active in the query string. Large
 * tap targets either side of the label — easy to step between months on
 * mobile with a thumb, no dropdown to open first.
 */
export function MonthStepper({ month, otherParams }: { month: string; otherParams: Record<string, string | undefined> }) {
  const prevHref = `/transactions?${buildQuery(otherParams, shiftMonth(month, -1))}`;
  const nextMonth = shiftMonth(month, 1);
  const nextDisabled = isCurrentOrFutureMonth(month);

  return (
    <Card padding="px-2 py-2" className="flex items-center justify-between">
      <Link
        href={prevHref}
        aria-label="Previous month"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-lg font-semibold"
        style={{ color: "var(--color-accent)" }}
      >
        ‹
      </Link>
      <span className="text-sm font-semibold">{monthLabel(month)}</span>
      {nextDisabled ? (
        <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-lg font-semibold" style={{ color: "var(--color-border)" }}>
          ›
        </span>
      ) : (
        <Link
          href={`/transactions?${buildQuery(otherParams, nextMonth)}`}
          aria-label="Next month"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-lg font-semibold"
          style={{ color: "var(--color-accent)" }}
        >
          ›
        </Link>
      )}
    </Card>
  );
}

function buildQuery(otherParams: Record<string, string | undefined>, month: string): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(otherParams)) {
    if (value) search.set(key, value);
  }
  search.set("month", month);
  return search.toString();
}
