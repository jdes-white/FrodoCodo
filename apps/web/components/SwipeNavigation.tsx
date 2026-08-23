"use client";

import { useRef, type ReactNode, type TouchEvent } from "react";
import { useRouter, usePathname } from "next/navigation";

/** Fixed left-to-right order swiping steps through — Home -> ... -> Settings, no wraparound. */
const ORDER = ["/", "/transactions", "/insights", "/plan", "/north-star", "/settings"];

/** Total horizontal travel a gesture needs before it counts as an intentional swipe, not a tap or a small scroll jitter. */
const DISTANCE_THRESHOLD = 60;
/** How much more horizontal than vertical travel a gesture needs to be treated as a page swipe rather than a vertical scroll/panel gesture. */
const DIRECTION_LOCK_RATIO = 1.5;

function currentIndex(pathname: string): number {
  if (pathname === "/") return 0;
  return ORDER.findIndex((route) => route !== "/" && pathname.startsWith(route));
}

/** True if the gesture started on an element that owns its own horizontal
 * interaction (inputs, buttons, links, sliders, or anything explicitly
 * opted out via data-swipe-ignore) — e.g. North Star's dependency dial is
 * a full-width `<input type="range">`, and dragging it must never be
 * mistaken for a page-swipe. */
function startedOnInteractiveElement(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return !!target.closest('input, textarea, select, button, a, [role="slider"], [data-swipe-ignore]');
}

/**
 * Wraps the app's main content area with left/right swipe-to-navigate
 * between the six primary destinations (§1 of the nav brief). Deliberately
 * a thin touchstart/touchend listener rather than tracking every
 * touchmove or ever calling preventDefault — Home and North Star's own
 * panel paging (components/PagedPanels.tsx) is native CSS scroll-snap
 * with no JS touch handling of its own, so this has nothing to coordinate
 * with beyond not misreading a vertical scroll gesture as a swipe. The
 * distance threshold + direction-lock ratio below do that: a gesture only
 * navigates once it's clearly moved further horizontally than vertically,
 * so a slightly diagonal vertical swipe still just scrolls/pages
 * normally. Navigation goes through next/navigation's router (a real
 * route change), so back/forward history behaves exactly like tapping a
 * nav link.
 */
export function SwipeNavigation({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const ignoreGesture = useRef(false);

  function onTouchStart(event: TouchEvent) {
    const touch = event.touches[0];
    if (!touch) return;
    ignoreGesture.current = startedOnInteractiveElement(event.target);
    touchStart.current = { x: touch.clientX, y: touch.clientY };
  }

  function onTouchEnd(event: TouchEvent) {
    const start = touchStart.current;
    touchStart.current = null;
    if (!start || ignoreGesture.current) return;

    const touch = event.changedTouches[0];
    if (!touch) return;

    const deltaX = touch.clientX - start.x;
    const deltaY = touch.clientY - start.y;

    if (Math.abs(deltaX) < DISTANCE_THRESHOLD) return;
    if (Math.abs(deltaX) < Math.abs(deltaY) * DIRECTION_LOCK_RATIO) return;

    const index = currentIndex(pathname);
    if (index === -1) return;

    if (deltaX < 0 && index < ORDER.length - 1) {
      router.push(ORDER[index + 1]!);
    } else if (deltaX > 0 && index > 0) {
      router.push(ORDER[index - 1]!);
    }
  }

  return (
    <div className="contents" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      {children}
    </div>
  );
}
