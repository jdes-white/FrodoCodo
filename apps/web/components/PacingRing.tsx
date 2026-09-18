import type { ReactNode } from "react";
import { clampArcPercent } from "@frodocodo/domain";

/*
 * Home's circular budget tracker — two arcs sharing one ring, so "where
 * should I be?" and "where am I?" read at a glance without an explanatory
 * caption underneath:
 *
 *  - a THICK arc (unchanged geometry from the original single-arc ring)
 *    for actual spend % of the flexible budget, colored by
 *    lib/pacePosition.ts's continuous paceGradientColor().
 *  - a THIN, visually subordinate outer arc plus a small endpoint marker
 *    for expected position % (how far through the period we are, or a
 *    smarter recurring-aware curve where one exists — see
 *    apps/web/lib/budgetSnapshot.ts's flexibleBudget.expectedSpendToDate).
 *
 * The viewBox grew (200 -> 232) purely to make room for the new outer
 * ring in the margin outside the original arc — the thick arc keeps its
 * original radius/stroke-width exactly, so nothing about the existing
 * "actual spend" visual changes size or position.
 */

const SIZE = 232;
const CENTER = SIZE / 2;

const THICK_RADIUS = 92;
const THICK_STROKE = 16;
const THICK_CIRCUMFERENCE = 2 * Math.PI * THICK_RADIUS;

const THIN_RADIUS = 108;
const THIN_STROKE = 5;
const THIN_CIRCUMFERENCE = 2 * Math.PI * THIN_RADIUS;

const MARKER_RADIUS = 5;

/** Point on the circle for a given percent (0=3 o'clock, sweeping toward
 * +Y/clockwise as percent increases) — matches the coordinate convention
 * SVG's own stroke-dasharray arc fill already uses, so a marker computed
 * this way lines up with the arc under the same `-rotate-90` CSS applied
 * to their shared parent <svg>. */
function pointOnCircle(radius: number, percent: number) {
  const angle = (clampArcPercent(percent) / 100) * 2 * Math.PI;
  return { x: CENTER + radius * Math.cos(angle), y: CENTER + radius * Math.sin(angle) };
}

export function PacingRing({
  actualPercent,
  expectedPercent,
  colorVar,
  children,
}: {
  /** Actual spend %, e.g. flexibleBudget.percentConsumed — may exceed 100 on an overspend; the arc fill is capped, this prop isn't. */
  actualPercent: number;
  /** Expected position % at this point in the period — e.g. flexibleBudget.expectedSpendToDate / allocation. */
  expectedPercent: number;
  /** A CSS color or color-mix() expression — see lib/pacePosition.ts's paceGradientColor. */
  colorVar: string;
  children?: ReactNode;
}) {
  const actualClamped = clampArcPercent(actualPercent);
  const expectedClamped = clampArcPercent(expectedPercent);
  const thickOffset = THICK_CIRCUMFERENCE * (1 - actualClamped / 100);
  const thinOffset = THIN_CIRCUMFERENCE * (1 - expectedClamped / 100);
  const marker = pointOnCircle(THIN_RADIUS, expectedClamped);

  return (
    <div className="relative mx-auto aspect-square" style={{ width: "clamp(190px, 65vw, 260px)" }}>
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="h-full w-full -rotate-90">
        {/* Background tracks for both rings. */}
        <circle cx={CENTER} cy={CENTER} r={THICK_RADIUS} fill="none" stroke="var(--color-border)" strokeWidth={THICK_STROKE} opacity={0.6} />
        <circle cx={CENTER} cy={CENTER} r={THIN_RADIUS} fill="none" stroke="var(--color-border)" strokeWidth={THIN_STROKE} opacity={0.4} />

        {/* Thin expected-position arc — subordinate to the thick arc: no
            fill cap indicating overspend, just a plain neutral reference. */}
        <circle
          cx={CENTER}
          cy={CENTER}
          r={THIN_RADIUS}
          fill="none"
          stroke="var(--color-text-muted)"
          strokeWidth={THIN_STROKE}
          strokeLinecap="round"
          strokeDasharray={THIN_CIRCUMFERENCE}
          strokeDashoffset={thinOffset}
          opacity={0.55}
        />
        <circle cx={marker.x} cy={marker.y} r={MARKER_RADIUS} fill="var(--color-text-muted)" opacity={0.85} />

        {/* Thick actual-spend arc — the primary, attention-getting element. */}
        <circle
          cx={CENTER}
          cy={CENTER}
          r={THICK_RADIUS}
          fill="none"
          stroke={colorVar}
          strokeWidth={THICK_STROKE}
          strokeLinecap="round"
          strokeDasharray={THICK_CIRCUMFERENCE}
          strokeDashoffset={thickOffset}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <div
          className="flex aspect-square flex-col items-center justify-center rounded-full text-center"
          style={{ width: "72%", background: "var(--color-surface)", boxShadow: "var(--shadow-card)" }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
