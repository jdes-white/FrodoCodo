"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

const ITEMS = [
  { href: "/", label: "Home", icon: "🏠" },
  { href: "/transactions", label: "Transactions", icon: "📋" },
  { href: "/insights", label: "Insights", icon: "💡" },
  { href: "/plan", label: "Plan", icon: "🎯" },
  { href: "/north-star", label: "North Star", icon: "🧭" },
  { href: "/settings", label: "Settings", icon: "⚙️" },
];

/**
 * Six equal-width grid columns (not flex-1) so every destination gets a
 * genuinely identical slot regardless of label length — that's what keeps
 * "North Star" from ever redistributing space away from its neighbours.
 * The active state highlights a small icon badge only, sized to the icon
 * rather than the label — a two-word label ("North Star") no longer
 * produces a wider highlighted block than its one-word neighbours, and a
 * fixed small badge can't crowd adjacent items. Labels are forced to one
 * line at a size that fits all six on real iPhone widths, so no item is
 * ever taller than its neighbours (previously "North Star" wrapped to two
 * lines and threw off icon/label alignment across the whole bar).
 *
 * Two latency-focused pieces (perf audit, §16):
 *  - Every destination is prefetched as soon as the nav bar mounts, not
 *    just the ones currently in the viewport (next/link's own automatic
 *    prefetch) — since every route here is fully dynamic (every page
 *    calls requireSession(), which reads cookies()), Link's default
 *    prefetch has little static shell to work with, so this explicitly
 *    warms the Router Cache for all six up front, right after the first
 *    authenticated page loads.
 *  - Each icon badge shows Next.js's real navigation-pending state
 *    (useLinkStatus) the instant it's tapped — before any network
 *    response — so a tap always gives immediate visual feedback even if
 *    the destination isn't in cache yet.
 */
export function NavBar() {
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    // Skip the route we're already on — prefetching it can't help (its
    // data is already rendered), and doing so risks the prefetch cache
    // colliding with a same-page router.refresh() (e.g. after saving a
    // North Star assumption edit) and serving stale data back.
    for (const item of ITEMS) {
      if (item.href !== pathname) router.prefetch(item.href);
    }
  }, [router, pathname]);

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-6 border-t pb-[env(safe-area-inset-bottom)] shadow-[var(--shadow-card)] sm:static sm:flex sm:justify-start sm:gap-1 sm:border-b sm:border-t-0 sm:px-4 sm:py-2"
      style={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}
    >
      {ITEMS.map((item) => {
        const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className="flex min-w-0 flex-col items-center justify-center gap-1 py-2 sm:flex-none sm:flex-row sm:gap-2 sm:px-3 sm:py-2"
          >
            <NavIcon icon={item.icon} active={active} />
            <span
              className="max-w-full truncate text-[10px] leading-none font-medium tracking-tight whitespace-nowrap sm:text-sm sm:tracking-normal"
              style={{ color: active ? "var(--color-accent)" : "var(--color-text-muted)" }}
            >
              {item.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}

/** A child of <Link>, so useLinkStatus() reports this specific link's own pending state — pulses the instant it's tapped, before the destination has actually loaded. */
function NavIcon({ icon, active }: { icon: string; active: boolean }) {
  const { pending } = useLinkStatus();
  return (
    <span
      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-base transition-colors sm:h-6 sm:w-6 ${pending ? "animate-pulse" : ""}`}
      style={{
        color: active ? "var(--color-accent)" : "var(--color-text-muted)",
        background: active ? "var(--color-accent-soft)" : "transparent",
      }}
      aria-hidden
    >
      {icon}
    </span>
  );
}
