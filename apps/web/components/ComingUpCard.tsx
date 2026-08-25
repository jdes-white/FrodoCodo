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
 * Deliberately omitted entirely by the caller when there are zero due
 * commitments, rather than rendered here in an empty state — an existing
 * household with nothing tracked should see Home exactly as it looked
 * before this feature existed (§7).
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
