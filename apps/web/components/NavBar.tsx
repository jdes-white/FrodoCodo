"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/", label: "Home", icon: "🏠" },
  { href: "/transactions", label: "Transactions", icon: "📋" },
  { href: "/insights", label: "Insights", icon: "💡" },
  { href: "/plan", label: "Plan", icon: "🎯" },
  { href: "/settings", label: "Settings", icon: "⚙️" },
];

export function NavBar() {
  const pathname = usePathname();

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-20 flex justify-around gap-1 border-t px-2 py-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] shadow-[var(--shadow-card)] sm:sticky sm:top-0 sm:justify-start sm:gap-1 sm:border-b sm:border-t-0 sm:px-4 sm:py-2"
      style={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}
    >
      {ITEMS.map((item) => {
        const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className="flex flex-1 flex-col items-center gap-0.5 rounded-xl px-2 py-1.5 text-[11px] font-medium transition-colors sm:flex-none sm:flex-row sm:gap-2 sm:px-3 sm:py-2 sm:text-sm"
            style={{
              color: active ? "var(--color-accent)" : "var(--color-text-muted)",
              background: active ? "var(--color-accent-soft)" : "transparent",
            }}
          >
            <span aria-hidden>{item.icon}</span>
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
