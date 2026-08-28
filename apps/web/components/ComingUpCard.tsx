import Link from "next/link";
import { Card } from "./Card";

const MUTED = { color: "var(--color-text-muted)" } as const;

export interface ComingUpPreviewItem {
  id: string;
  name: string;
  dateDisplay: string;
  amountDisplay: string;
}

/**
 * Home Page 2's "Coming Up" widget (§1 of the Upcoming Commitments V1
 * spec) — a plain server-rendered Link into /commitments, not a client
 * component, since it needs no interactivity of its own beyond
 * navigation. Bounded to at most two preview rows (`items` is already
 * sliced by the caller) regardless of how many commitments are actually
 * due, so this can never grow tall enough to push Home Page 2 into
 * internal scroll (see app/(app)/page.tsx's Panel2 doc comment — the
 * whole panel must fit one viewport with no clipped content).
 *
 * When nothing is due this period, the caller renders `ComingUpEmptyCard`
 * (below) instead of this component — never nothing at all. An earlier
 * version of this feature hid the entire slot whenever there was nothing
 * due, on the theory that an untouched household should see Home exactly
 * as before; in practice that left zero discoverable path to the feature
 * for a brand-new household, since nothing else on Home (or in the bottom
 * nav, deliberately) points at /commitments. The "always show *something*
 * here" fix keeps the same one-slot footprint either way.
 */
export function ComingUpCard({
  items,
  overflowCount,
  overflowAmountDisplay,
  committedDisplay,
  isShortfall,
  uncommittedDisplay,
}: {
  items: ComingUpPreviewItem[];
  overflowCount: number;
  overflowAmountDisplay: string | null;
  committedDisplay: string;
  isShortfall: boolean;
  uncommittedDisplay: string;
}) {
  return (
    <Link href="/commitments" className="block transition hover:opacity-90">
      <Card padding="p-2.5" className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-semibold tracking-wide uppercase" style={MUTED}>
            Coming up
          </span>
          <span className="text-[10px]" style={MUTED} aria-hidden>
            →
          </span>
        </div>

        <div className="flex flex-col gap-0.5">
          {items.map((item) => (
            <div key={item.id} className="flex items-center justify-between gap-2 text-[11px]">
              <span className="min-w-0 flex-1 truncate">
                {item.name} · {item.dateDisplay}
              </span>
              <span className="shrink-0 font-medium">{item.amountDisplay}</span>
            </div>
          ))}
          {overflowCount > 0 && overflowAmountDisplay && (
            <div className="flex items-center justify-between gap-2 text-[11px]" style={MUTED}>
              <span>+{overflowCount} more</span>
              <span>{overflowAmountDisplay}</span>
            </div>
          )}
        </div>

        <div className="mt-0.5 grid grid-cols-2 gap-1.5 border-t pt-1.5" style={{ borderColor: "var(--color-border)" }}>
          <div>
            <p className="text-[9px] font-semibold tracking-wide uppercase" style={MUTED}>
              Committed
            </p>
            <p className="text-sm font-bold">{committedDisplay}</p>
          </div>
          <div className="text-right">
            <p className="text-[9px] font-semibold tracking-wide uppercase" style={MUTED}>
              {isShortfall ? "Shortfall" : "Uncommitted"}
            </p>
            <p className="text-sm font-bold" style={isShortfall ? { color: "var(--status-off-track)" } : undefined}>
              {isShortfall ? `${uncommittedDisplay} short` : uncommittedDisplay}
            </p>
          </div>
        </div>
      </Card>
    </Link>
  );
}

/**
 * The always-visible fallback for the same Home Page 2 slot when nothing
 * is due this period — either a brand-new household with no commitments
 * at all, or one whose tracked bills all fall outside the current period.
 * Same header treatment and tap target as ComingUpCard, so the entry
 * point into /commitments is obvious and consistent whether or not
 * there's anything to show yet.
 */
export function ComingUpEmptyCard() {
  return (
    <Link href="/commitments" className="block transition hover:opacity-90">
      <Card padding="p-2.5" className="flex items-center justify-between gap-2">
        <div>
          <span className="text-[10px] font-semibold tracking-wide uppercase" style={MUTED}>
            Coming up
          </span>
          <p className="text-[11px]" style={MUTED}>
            No bills tracked for this period — tap to add one
          </p>
        </div>
        <span className="shrink-0 text-[10px] font-semibold" style={{ color: "var(--color-accent)" }}>
          + Add
        </span>
      </Card>
    </Link>
  );
}
