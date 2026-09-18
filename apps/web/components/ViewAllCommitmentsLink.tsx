import Link from "next/link";

const MUTED = { color: "var(--color-text-muted)" } as const;

/**
 * Home Page 2's entry point into /commitments, replacing the old
 * full-width "Coming Up" card (see git history for ComingUpCard.tsx) now
 * that individual commitment detail lives inside each bucket card's due
 * line + bottom sheet instead. Deliberately just a compact row — the
 * per-commitment list, totals, and committed/uncommitted breakdown that
 * used to live here would now duplicate what the bucket cards already
 * show (per the Home Page 2 bucket-card integration spec: "do not
 * duplicate individual commitment details both inside the category cards
 * and in a permanent Coming Up panel").
 */
export function ViewAllCommitmentsLink() {
  return (
    <Link href="/commitments" className="flex items-center justify-between gap-2 px-1 py-0.5 transition hover:opacity-80">
      <span>
        <span className="block text-xs font-semibold" style={{ color: "var(--color-accent)" }}>
          View all upcoming commitments
        </span>
        <span className="block text-[10px]" style={MUTED}>
          See everything over the next 30 days
        </span>
      </span>
      <span className="shrink-0 text-xs" style={MUTED} aria-hidden>
        ›
      </span>
    </Link>
  );
}
