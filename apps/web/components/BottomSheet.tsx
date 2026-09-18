"use client";

import type { ReactNode } from "react";
import { useEffect } from "react";

/**
 * A minimal mobile bottom-sheet overlay — `position: fixed` over the whole
 * viewport with its own internal scroll, so opening it can never affect the
 * height of whatever page is underneath. This matters specifically for
 * Home Page 2 (see BucketCard.tsx / app/(app)/page.tsx's Panel2), which
 * must always fit one viewport with zero internal scroll
 * (e2e/home-panels.spec.ts asserts this at iPhone SE/14 sizes) — expanding
 * a bucket's commitments *in place* would grow Panel2's own content height
 * and break that; an overlay sidesteps the constraint entirely instead of
 * fighting it.
 *
 * Deliberately built from scratch rather than adapted from an existing
 * component — there was no modal/bottom-sheet pattern anywhere in this
 * codebase before this. The drag-handle bar at top is purely the
 * conventional visual cue for "this is a sheet, swipe/tap away to
 * dismiss" — there's no swipe-to-dismiss gesture wired up, just tap-the-
 * backdrop and the explicit close affordance the caller renders inside.
 */
export function BottomSheet({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 h-full w-full"
        style={{ background: "rgba(0,0,0,0.4)" }}
      />
      <div
        role="dialog"
        aria-modal="true"
        className="relative z-10 flex max-h-[85vh] flex-col gap-3 overflow-y-auto rounded-t-3xl border-x border-t p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
        style={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}
      >
        <div className="mx-auto h-1.5 w-10 shrink-0 rounded-full" style={{ background: "var(--color-border)" }} aria-hidden />
        {children}
      </div>
    </div>
  );
}
