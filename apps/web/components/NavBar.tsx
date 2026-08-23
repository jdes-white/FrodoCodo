"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

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
 * rather than the label — a two-word label like "North Star" would make
 * a label-width background look lopsided next to five one-word items, and
 * an icon-sized badge is identical for every item no matter what its
 * label says. Labels are forced to one line (whitespace-nowrap) at a
 * small enough size that all six fit even at the narrowest common iPhone
 * width, so every item's icon and label sit at the same two fixed
 * vertical positions — no item is ever taller than its neighbours.
 */
export function NavBar() {
  const pathname = usePathname();

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
            <span
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-base transition-colors sm:h-6 sm:w-6"
              style={{
                color: active ? "var(--color-accent)" : "var(--color-text-muted)",
                background: active ? "var(--color-accent-soft)" : "transparent",
              }}
              aria-hidden
            >
              {item.icon}
            </span>
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
