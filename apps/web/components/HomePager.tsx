"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Mobile: two full-height panels the user pages between via vertical
 * swipe/scroll, using native CSS scroll-snap (scroll-snap-type: y mandatory
 * + snap-align: start on each panel) rather than a JS carousel — the
 * browser guarantees it never rests halfway between panels. The container's
 * height is computed to exactly fill the space between the app header and
 * the fixed bottom nav (--app-chrome-h, see globals.css), so each panel is
 * the only thing that could scroll — and panel content itself is expected
 * to already fit without overflowing (kept sparse/compact by the caller).
 *
 * Desktop/tablet (sm and up): the pagination metaphor doesn't make sense
 * on a screen with room to spare, so this renders as an ordinary stacked,
 * normally-scrolling flex column instead — no snapping, no fixed height.
 *
 * The two dots are a lightweight existence hint ("there's a second panel"),
 * not instructions — no "swipe up" text. Active-dot tracking uses an
 * IntersectionObserver against the scroll container itself, so it works
 * without listening to raw scroll events.
 */
export function HomePager({ panels }: { panels: [ReactNode, ReactNode] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const sections = Array.from(container.children) as HTMLElement[];

    const observer = new IntersectionObserver(
      (entries) => {
        const mostVisible = entries.filter((e) => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (mostVisible) setActive(sections.indexOf(mostVisible.target as HTMLElement));
      },
      { root: container, threshold: [0.5, 0.75] },
    );
    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, []);

  return (
    <div className="relative">
      <div
        ref={containerRef}
        className="h-[calc(100dvh_-_var(--app-chrome-h))] snap-y snap-mandatory overflow-y-auto overscroll-y-contain sm:flex sm:h-auto sm:snap-none sm:flex-col sm:gap-6 sm:overflow-visible"
      >
        {panels.map((panel, i) => (
          <section key={i} className="h-full snap-start snap-always sm:h-auto">
            {panel}
          </section>
        ))}
      </div>

      <div className="pointer-events-none absolute top-1/2 right-1 flex -translate-y-1/2 flex-col items-center gap-1.5 sm:hidden" aria-hidden>
        {panels.map((_, i) => (
          <span
            key={i}
            className="w-1.5 rounded-full transition-all duration-200"
            style={{
              height: active === i ? 16 : 6,
              background: active === i ? "var(--color-accent)" : "var(--color-border)",
            }}
          />
        ))}
      </div>
    </div>
  );
}
