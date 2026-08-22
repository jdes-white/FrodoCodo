"use client";

import { useState } from "react";
import { toMoney, clampMin, formatCompactAUD } from "@frodocodo/shared";
import { requiredIndependentIncomeForDependency } from "@frodocodo/domain";

const SIZE_W = 240;
const SIZE_H = 150;
const CENTER_X = 120;
const CENTER_Y = 120;
const RADIUS = 96;
const STROKE = 14;

const ARC_PATH = `M ${CENTER_X - RADIUS} ${CENTER_Y} A ${RADIUS} ${RADIUS} 0 0 1 ${CENTER_X + RADIUS} ${CENTER_Y}`;

/** 100% sits at the left end of the arc, 0% at the right (§6/§7) — angle
 * sweeps 180°→0° as percent goes 100→0, matching a standard unit-circle
 * upper semicircle (percent 50 lands exactly at the top). */
function pointFor(percent: number) {
  const angleRad = ((percent / 100) * 180 * Math.PI) / 180;
  return { x: CENTER_X + RADIUS * Math.cos(angleRad), y: CENTER_Y - RADIUS * Math.sin(angleRad) };
}

/**
 * The interactive Employment Dependency dial (§7). Dragging explores what
 * independent income a different dependency level would need — it never
 * writes to the household's stored assumptions, so the "actual" marker
 * (today's real position) stays fixed on the arc the whole time as a
 * separate, non-interactive reference point.
 *
 * Implementation: an invisible native `<input type="range">` (dir="rtl" so
 * dragging left increases the value, matching 100% sitting on the left)
 * is layered over a custom SVG arc rather than hand-rolling pointer-event
 * angle math — this gets keyboard support, touch/mouse dragging, and
 * accessibility semantics for free. The visible thumb is hidden
 * (.dial-range in globals.css); the SVG circle is the only thing the user
 * sees move.
 *
 * While not actively being dragged, the readout card defaults to the next
 * automatic milestone (matching the mockup's resting state) rather than
 * mirroring the actual position 1:1 — dragging temporarily overrides it,
 * and releasing reverts back to the milestone.
 */
export function DependencyDial({
  actualPercent,
  milestonePercent,
  lifestyleTarget,
  independentIncomeToday,
}: {
  actualPercent: number;
  milestonePercent: number;
  lifestyleTarget: number;
  independentIncomeToday: number;
}) {
  const [dragPercent, setDragPercent] = useState<number | null>(null);
  const isExploring = dragPercent !== null;
  const displayPercent = dragPercent ?? milestonePercent;

  const required = requiredIndependentIncomeForDependency(toMoney(lifestyleTarget), displayPercent);
  const gap = clampMin(required.minus(toMoney(independentIncomeToday)));

  const actualPoint = pointFor(actualPercent);
  const handlePoint = pointFor(displayPercent);

  const endDrag = () => setDragPercent(null);

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative mx-auto w-full" style={{ maxWidth: 160 }}>
        <svg viewBox={`0 0 ${SIZE_W} ${SIZE_H}`} className="w-full" aria-hidden>
          <defs>
            <linearGradient id="dependency-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="var(--status-behind)" />
              <stop offset="100%" stopColor="var(--status-ahead)" />
            </linearGradient>
          </defs>
          <path d={ARC_PATH} fill="none" stroke="url(#dependency-gradient)" strokeWidth={STROKE} strokeLinecap="round" opacity={0.85} />
          <circle cx={actualPoint.x} cy={actualPoint.y} r={6} fill="var(--color-surface)" stroke="var(--color-text)" strokeWidth={2.5} />
          <circle cx={handlePoint.x} cy={handlePoint.y} r={10} fill="var(--color-accent)" stroke="var(--color-surface)" strokeWidth={3} />
        </svg>

        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={displayPercent}
          dir="rtl"
          aria-label="Explore a different employment dependency level"
          onChange={(e) => setDragPercent(Number(e.target.value))}
          onPointerUp={endDrag}
          onKeyUp={endDrag}
          onBlur={endDrag}
          className="dial-range absolute inset-x-0 top-0 h-full w-full cursor-pointer"
        />
      </div>

      <div className="flex w-full justify-between px-1 text-[11px] font-medium" style={{ color: "var(--color-text-muted)" }}>
        <span>100% · Salary dependent</span>
        <span>0% · Work optional</span>
      </div>

      <div className="text-center">
        <p className="text-2xl font-extrabold tracking-tight">{actualPercent.toFixed(1)}%</p>
        <p className="text-[11px]" style={{ color: "var(--color-text-muted)" }}>
          Employment dependency today
        </p>
      </div>

      <div className="w-full rounded-2xl border p-2 text-center" style={{ borderColor: "var(--color-border)", background: "var(--color-accent-soft)" }}>
        <p className="text-[11px] font-medium" style={{ color: "var(--color-text-muted)" }}>
          {isExploring ? `To reach ${displayPercent}% or below` : `Next milestone: below ${displayPercent}%`}
        </p>
        <p className="text-lg font-bold" style={{ color: "var(--color-accent-strong)" }}>
          {formatCompactAUD(required)} p.a. needed
        </p>
        <p className="text-[11px]" style={{ color: "var(--color-text-muted)" }}>
          {gap.isZero() ? "Already there" : `${formatCompactAUD(gap)} more than today's ${formatCompactAUD(toMoney(independentIncomeToday))}`}
        </p>
      </div>
    </div>
  );
}
