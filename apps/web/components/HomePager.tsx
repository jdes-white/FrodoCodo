"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Mobile: two full-height panels the user pages between via vertical
 * swipe/scroll, using native CSS scroll-snap (scroll-snap-type: y mandatory
 * + snap-align: start on each panel) rather than a JS carousel — the
 * browser guarantees it never rests halfway between panels.
 *
 * Both the panel container and the dot indicator are `position: fixed`,
 * anchored directly to `top: var(--app-header-h)` / `bottom: var(--app-nav-h)`
 * (app/globals.css) rather than sized via `calc(100dvh - ...)` arithmetic
 * that had to guess how much padding the surrounding layout (<main>'s
 * py-6, the app shell's pb-20) added — that guess drifted from real
 * devices and clipped panel content top and bottom. Fixed positioning is
 * measured against the viewport directly, so it only depends on the
 * header/nav heights, which are themselves fixed (h-16 / h-14) rather
 * than intrinsic. Giving the dots their own fixed box spanning the same
 * region (rather than absolutely positioning them inside a wrapper that
 * now contains only fixed children and would collapse to zero height)
 * keeps them correctly centered on the actual visible panel area.
 *
 * Desktop/tablet (sm and up): the pagination metaphor doesn't make sense
 * on a screen with room to spare, so this reverts to `position: static`
 * and renders as an ordinary stacked, normally-scrolling flex column
 * instead — no snapping, no fixed positioning, no dots.
 *
 * The two dots are a lightweight existence hint ("there's a second panel"),
 * not instructions — no "swipe up" text. Active-dot tracking uses an
 * IntersectionObserver against the scroll container itself, so it works
 * without listening to raw scroll events. The native scrollbar is hidden
 * (.no-scrollbar) — the dots are the only paging indicator.
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
    <>
      <div
        ref={containerRef}
        className="no-scrollbar fixed inset-x-0 snap-y snap-mandatory overflow-y-auto overscroll-y-contain sm:static sm:flex sm:snap-none sm:flex-col sm:gap-6 sm:overflow-visible"
        style={{ top: "var(--app-header-h)", bottom: "var(--app-nav-h)" }}
      >
        {panels.map((panel, i) => (
          <section key={i} className="h-full snap-start snap-always sm:h-auto">
            {panel}
          </section>
        ))}
      </div>

      <div
        className="pointer-events-none fixed inset-x-0 z-10 flex items-center justify-end pr-1 sm:hidden"
        style={{ top: "var(--app-header-h)", bottom: "var(--app-nav-h)" }}
        aria-hidden
      >
        <div className="flex flex-col items-center gap-1.5">
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
    </>
  );
}
