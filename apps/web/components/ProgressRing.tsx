import type { ReactNode } from "react";

const SIZE = 200;
const STROKE_WIDTH = 16;
const RADIUS = (SIZE - STROKE_WIDTH) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * Circular progress hero (Home's "how much is left" at-a-glance ring).
 * The SVG's own coordinate space stays fixed (viewBox) while the outer
 * container is sized with a responsive clamp() — so this scales cleanly
 * across phone widths instead of being pinned to one screenshot's pixel
 * dimensions.
 */
export function ProgressRing({ percent, colorVar, children }: { percent: number; colorVar: string; children?: ReactNode }) {
  const clamped = Math.min(Math.max(percent, 0), 100);
  const offset = CIRCUMFERENCE * (1 - clamped / 100);

  return (
    <div className="relative mx-auto aspect-square" style={{ width: "clamp(200px, 62vw, 260px)" }}>
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="h-full w-full -rotate-90">
        <circle cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} fill="none" stroke="var(--color-border)" strokeWidth={STROKE_WIDTH} opacity={0.6} />
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          stroke={colorVar}
          strokeWidth={STROKE_WIDTH}
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={offset}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <div
          className="flex aspect-square flex-col items-center justify-center rounded-full text-center"
          style={{ width: "76%", background: "var(--color-surface)", boxShadow: "var(--shadow-card)" }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
