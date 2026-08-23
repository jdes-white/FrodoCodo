import { formatAUD, formatCompactAUD } from "@frodocodo/shared";
import type { ReactNode } from "react";
import { TilePair, type TileConfig } from "@/components/TilePair";
import { SurplusSummary } from "@/components/SurplusSummary";
import type { getNorthStarSnapshot } from "@/lib/northStar";

const MUTED = { color: "var(--color-text-muted)" } as const;

/**
 * "Build your engine" — Page 2. A compact assumption control panel, not a
 * settings page: every value is visible at a glance as a two-column grid
 * of tiles (icon + short label + value only), and explanation/editing
 * lives behind a tap via TilePair (components/TilePair.tsx) rather than
 * being permanently on screen. That's what lets the whole collapsed page
 * fit roughly one mobile viewport instead of the ~3 screens a fully
 * expanded card-per-assumption layout took.
 *
 * Unlike Panel1, this page is still allowed to scroll *within itself* if
 * a tile is expanded (temporary extra height is fine) — the outer
 * `overflow-y-auto` here is deliberately separate from PagedPanels' own
 * snap-scrolling container (its section is always exactly one viewport
 * tall), so paging between Page 1 and Page 2 still snaps cleanly.
 */
export function AssumptionsPanel({ snapshot }: { snapshot: Awaited<ReturnType<typeof getNorthStarSnapshot>> }) {
  const { inputs, surplus, targetEmploymentDependency } = snapshot;

  const lifestyle: TileConfig = {
    kind: "number",
    icon: "🏡",
    label: "Lifestyle",
    displayValue: formatCompactAUD(inputs.lifestyleTarget),
    field: "lifestyleTarget",
    currentValue: inputs.lifestyleTarget.toNumber(),
    step: "1000",
    suffix: "/ yr",
    title: "Lifestyle to fund",
    description: "Annual lifestyle cost to fund, in today's dollars.",
  };
  const employment: TileConfig = {
    kind: "number",
    icon: "💼",
    label: "Employment",
    displayValue: formatCompactAUD(inputs.employmentIncome),
    field: "employmentIncome",
    currentValue: inputs.employmentIncome.toNumber(),
    step: "1000",
    suffix: "/ yr",
    title: "Employment income",
    description: "Combined household income, after tax.",
  };

  const investedAssets: TileConfig = {
    kind: "number",
    icon: "📈",
    label: "Invested assets",
    displayValue: formatCompactAUD(inputs.investedAssetsToday),
    field: "investedAssetsToday",
    currentValue: inputs.investedAssetsToday.toNumber(),
    step: "1000",
    title: "Invested assets today",
    description: "Total value of investable assets today.",
  };
  const incomeProducingPortion: TileConfig = {
    kind: "number",
    icon: "🪙",
    label: "Income-producing",
    displayValue: `${(inputs.incomeProducingPortion * 100).toFixed(0)}%`,
    field: "incomeProducingPortion",
    currentValue: inputs.incomeProducingPortion * 100,
    step: "1",
    suffix: "%",
    title: "Income-producing portion",
    description: "Share of assets treated as cash-yield-bearing.",
  };

  const cashYield: TileConfig = {
    kind: "number",
    icon: "💧",
    label: "Cash yield",
    displayValue: `${(inputs.cashYield * 100).toFixed(1)}%`,
    field: "cashYield",
    currentValue: inputs.cashYield * 100,
    step: "0.1",
    suffix: "%",
    title: "Cash yield",
    description: "Yield on the income-producing portion of investments.",
  };
  const capitalGrowth: TileConfig = {
    kind: "number",
    icon: "🌱",
    label: "Capital growth",
    displayValue: `${(inputs.capitalGrowthAssumption * 100).toFixed(1)}%`,
    field: "capitalGrowthAssumption",
    currentValue: inputs.capitalGrowthAssumption * 100,
    step: "0.1",
    suffix: "%",
    title: "Capital growth",
    description: "Expected growth in investment asset value. Used for projection only — never counted directly as income.",
  };

  const reinvest: TileConfig = {
    kind: "toggle",
    icon: "♻️",
    label: "Reinvest income",
    displayValue: inputs.reinvestInvestmentIncome ? "Yes" : "No",
    currentValue: inputs.reinvestInvestmentIncome,
    title: "Reinvest investment income",
    description: "Counts toward capacity either way.",
  };
  const contribution: TileConfig = {
    kind: "number",
    icon: "💸",
    label: "Contribution",
    displayValue: `${formatCompactAUD(inputs.plannedAnnualContribution)} p.a.`,
    field: "plannedAnnualContribution",
    currentValue: inputs.plannedAnnualContribution.toNumber(),
    step: "500",
    suffix: "/ yr",
    title: "Annual contribution",
    description: "Starts equal to surplus, editable independently.",
  };

  const sideIncome: TileConfig = {
    kind: "number",
    icon: "🚀",
    label: "Side income",
    displayValue: formatCompactAUD(inputs.sideBusinessIncome),
    field: "sideBusinessIncome",
    currentValue: inputs.sideBusinessIncome.toNumber(),
    step: "500",
    suffix: "/ yr",
    title: "Side business / hustle income",
    description: "After tax and associated costs.",
  };
  const otherPassive: TileConfig = {
    kind: "number",
    icon: "🌤️",
    label: "Other passive",
    displayValue: formatCompactAUD(inputs.otherPassiveIncome),
    field: "otherPassiveIncome",
    currentValue: inputs.otherPassiveIncome.toNumber(),
    step: "500",
    suffix: "/ yr",
    title: "Other passive income",
    description: "After tax and associated costs.",
  };

  const horizon: TileConfig = {
    kind: "number",
    icon: "⏳",
    label: "Horizon",
    displayValue: `${inputs.timeHorizonYears} yr`,
    field: "timeHorizonYears",
    currentValue: inputs.timeHorizonYears,
    step: "1",
    min: 1,
    suffix: "yrs",
    title: "Planning horizon",
    description: "How many years ahead the projection looks.",
  };
  const targetDependency: TileConfig = {
    kind: "number",
    icon: "🎯",
    label: "Target dependency",
    displayValue: `${targetEmploymentDependency}%`,
    field: "targetEmploymentDependency",
    currentValue: targetEmploymentDependency,
    step: "1",
    suffix: "%",
    title: "Target employment dependency",
    description: targetEmploymentDependency <= 0 ? "0% = work optional." : "The dependency level you're aiming for.",
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto px-4 py-2.5">
      <div className="mb-1.5">
        <h2 className="text-lg font-bold sm:text-xl">Build your engine</h2>
        {/* Same trick as Page 1: the tiles are self-explanatory, so this
            caption only earns its space where there's headroom to spare. */}
        <p className="hidden text-xs sm:block" style={MUTED}>
          Tap a tile to explain or edit it.
        </p>
      </div>

      <div className="mx-auto flex w-full max-w-sm flex-col gap-2 pb-2">
        <Section title="Our life">
          <TilePair left={lifestyle} right={employment} />
        </Section>

        <Section title="Investments">
          <TilePair left={investedAssets} right={incomeProducingPortion} />
          <TilePair left={cashYield} right={capitalGrowth} />
          <TilePair left={reinvest} right={contribution} />
        </Section>

        <Section title="Other engines">
          <TilePair left={sideIncome} right={otherPassive} />
        </Section>

        <Section title="Direction">
          <TilePair left={horizon} right={targetDependency} />
          <SurplusSummary employmentIncome={formatAUD(inputs.employmentIncome)} lifestyleTarget={formatAUD(inputs.lifestyleTarget)} surplus={formatAUD(surplus)} />
        </Section>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <h3 className="px-1 text-[10px] font-semibold tracking-wide uppercase" style={MUTED}>
        {title}
      </h3>
      <div className="flex flex-col gap-1">{children}</div>
    </div>
  );
}
