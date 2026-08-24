"use client";

import { useState } from "react";
import { toMoney, clampMin, formatAUD, formatCompactAUD } from "@frodocodo/shared";
import { requiredIndependentIncomeForDependency } from "@frodocodo/domain";
import { DependencyDial } from "@/components/DependencyDial";
import { StatTile } from "@/components/StatTile";
import { Card } from "@/components/Card";

const MUTED = { color: "var(--color-text-muted)" } as const;

/**
 * "How dependent are we on employment today?" — the North Star hero.
 * Owns the dial's *scenario* state: dragging the dial no longer snaps
 * back to the live figures on release — it commits a persistent scenario
 * that stays active (and keeps every stat/caption on this panel in sync
 * with it) until the household taps Reset · Live or navigates away from
 * North Star entirely. That's a plain `useState` here rather than
 * anything persisted — leaving North Star unmounts this component and
 * the scenario disappears with it, and nothing here ever calls a server
 * action, so no scenario value can leak into the household's stored
 * assumptions. Swiping to Page 2 and back doesn't reset it because
 * PagedPanels keeps both panels mounted the whole time (see
 * components/PagedPanels.tsx) — this component simply never unmounts
 * from that gesture.
 *
 * Every number here still traces back to packages/domain/src/northStar.ts
 * (CLAUDE.md rule 1) — `requiredIndependentIncomeForDependency` is the
 * exact same pure function the server-computed "live" figures already
 * used; scenario mode just re-evaluates it against the household's chosen
 * percent instead of the next automatic milestone.
 */
export function NorthStarHero({
  lifestyleTarget,
  actualIndependentIncome,
  actualDependencyPercent,
  milestonePercent,
  liveWorthConsidering,
}: {
  lifestyleTarget: number;
  actualIndependentIncome: number;
  actualDependencyPercent: number;
  milestonePercent: number;
  liveWorthConsidering: string;
}) {
  const [scenarioPercent, setScenarioPercent] = useState<number | null>(null);
  const isScenario = scenarioPercent !== null;
  // The dial's own resting position when nothing has ever been dragged is
  // the next milestone (matches the original static mockup) — once a
  // scenario is committed, that replaces it everywhere on this panel.
  const displayPercent = scenarioPercent ?? milestonePercent;

  const required = requiredIndependentIncomeForDependency(toMoney(lifestyleTarget), displayPercent);
  const gap = clampMin(required.minus(toMoney(actualIndependentIncome)));

  const reset = () => setScenarioPercent(null);

  return (
    <div className="flex h-full flex-col justify-center gap-1.5 px-4">
      <div>
        <h1 className="text-xl font-bold sm:text-2xl">North Star</h1>
        {/* The dial and its labels already answer this on small screens —
            keeping the caption only where there's headroom to spare. */}
        <p className="hidden text-sm sm:block" style={MUTED}>
          How dependent are we on employment, today?
        </p>
      </div>

      <Card className="hero-sky mx-auto w-full max-w-sm" padding="p-3">
        <DependencyDial actualPercent={actualDependencyPercent} value={displayPercent} onChange={setScenarioPercent} />

        <div className="mt-2 w-full rounded-2xl border p-2 text-center" style={{ borderColor: "var(--color-border)", background: "var(--color-accent-soft)" }}>
          <div className="flex items-center gap-2">
            <p className="flex-1 text-left text-[11px] font-medium" style={MUTED}>
              {isScenario ? `Scenario: ${displayPercent}% dependency` : `Next milestone: below ${displayPercent}%`}
            </p>
            {isScenario && (
              <button
                type="button"
                onClick={reset}
                className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold"
                style={{ background: "var(--color-surface)", color: "var(--color-accent)" }}
              >
                Reset · Live
              </button>
            )}
          </div>
          <p className="mt-1 text-lg font-bold" style={{ color: "var(--color-accent-strong)" }}>
            {formatCompactAUD(required)} p.a. needed
          </p>
          <p className="text-[11px]" style={MUTED}>
            {gap.isZero() ? "Already there" : `${formatCompactAUD(gap)} more than today's ${formatCompactAUD(toMoney(actualIndependentIncome))}`}
          </p>
        </div>
      </Card>

      <div className="mx-auto grid w-full max-w-sm grid-cols-2 gap-1">
        <StatTile padding="p-1.5" icon="🏡" label="Lifestyle to fund" value={formatAUD(toMoney(lifestyleTarget))} sublabel="per year, today's dollars" />
        <StatTile
          padding="p-1.5"
          icon="💰"
          label="Independent income"
          value={isScenario ? formatAUD(required) : formatAUD(toMoney(actualIndependentIncome))}
          sublabel={isScenario ? `required for ${displayPercent}% scenario` : "sustainable, per year"}
        />
        <StatTile
          padding="p-1.5"
          icon="🧭"
          label="Dependency"
          value={isScenario ? `${displayPercent}%` : `${actualDependencyPercent.toFixed(1)}%`}
          sublabel={isScenario ? "selected scenario" : "lower is more independent"}
        />
        {isScenario ? (
          <StatTile padding="p-1.5" icon="🚩" label="Income needed" value={formatAUD(gap)} sublabel={`additional, for ${displayPercent}% scenario`} />
        ) : (
          <StatTile padding="p-1.5" icon="🚩" label="Next milestone" value={`Below ${milestonePercent}%`} sublabel="10-point automatic step" />
        )}
      </div>

      <p className="mx-auto max-w-sm text-center text-xs leading-snug font-medium" style={{ color: "var(--color-accent-strong)" }}>
        {isScenario ? `Exploring a ${displayPercent}% dependency scenario — tap Reset · Live to return to today.` : liveWorthConsidering}
      </p>
    </div>
  );
}
