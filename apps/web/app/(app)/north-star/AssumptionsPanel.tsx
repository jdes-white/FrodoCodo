import { formatAUD, formatCompactAUD } from "@frodocodo/shared";
import type { ReactNode } from "react";
import { Card } from "@/components/Card";
import { EditableRow } from "@/components/EditableRow";
import { toggleReinvestInvestmentIncome } from "./actions";
import type { getNorthStarSnapshot } from "@/lib/northStar";

const MUTED = { color: "var(--color-text-muted)" } as const;

/**
 * "Build your engine" — Page 2 (§11). The slower-moving assumptions behind
 * North Star, grouped exactly as the mockup does. Unlike Panel1, this page
 * is allowed to be denser and to scroll *within itself* — the outer
 * `overflow-y-auto` here is deliberately separate from PagedPanels' own
 * snap-scrolling container (its section is always exactly one viewport
 * tall), so paging between Page 1 and Page 2 still snaps cleanly even
 * though this page's content can be taller than the viewport (§12).
 */
export function AssumptionsPanel({ snapshot }: { snapshot: Awaited<ReturnType<typeof getNorthStarSnapshot>> }) {
  const { inputs, surplus, projection } = snapshot;
  const midYear = Math.min(5, inputs.timeHorizonYears);
  // projectNorthStar always returns one entry per year 0..timeHorizonYears
  // inclusive, so these three indices are guaranteed to exist.
  const columns = [
    { label: "Today", entry: projection[0]! },
    { label: `${midYear}yr`, entry: projection[midYear]! },
    { label: `${inputs.timeHorizonYears}yr`, entry: projection[inputs.timeHorizonYears]! },
  ];

  return (
    <div className="flex h-full flex-col overflow-y-auto px-4 py-4">
      <div className="mb-3">
        <h2 className="text-lg font-bold sm:text-xl">Build your engine</h2>
        <p className="text-xs" style={MUTED}>
          Tap any row to edit. Everything here is in today&apos;s dollars.
        </p>
      </div>

      <div className="mx-auto flex w-full max-w-sm flex-col gap-4 pb-2">
        <Section title="Our life">
          <EditableRow icon="🏡" label="Lifestyle to fund" displayValue={formatAUD(inputs.lifestyleTarget)} field="lifestyleTarget" currentValue={inputs.lifestyleTarget.toNumber()} step="1000" suffix="/ yr" />
          <EditableRow
            icon="💼"
            label="Employment income"
            sublabel="Combined, after tax"
            displayValue={formatAUD(inputs.employmentIncome)}
            field="employmentIncome"
            currentValue={inputs.employmentIncome.toNumber()}
            step="1000"
            suffix="/ yr"
          />
        </Section>

        <Section title="Investments">
          <EditableRow
            icon="📈"
            label="Invested assets today"
            displayValue={formatAUD(inputs.investedAssetsToday)}
            field="investedAssetsToday"
            currentValue={inputs.investedAssetsToday.toNumber()}
            step="1000"
          />
          <EditableRow
            icon="🪙"
            label="Income-producing portion"
            sublabel="Share of assets treated as cash-yield-bearing"
            displayValue={`${(inputs.incomeProducingPortion * 100).toFixed(0)}%`}
            field="incomeProducingPortion"
            currentValue={inputs.incomeProducingPortion * 100}
            step="1"
            suffix="%"
          />
          <EditableRow
            icon="💧"
            label="Cash yield"
            sublabel="On the income-producing portion"
            displayValue={`${(inputs.cashYield * 100).toFixed(1)}%`}
            field="cashYield"
            currentValue={inputs.cashYield * 100}
            step="0.1"
            suffix="%"
          />
          <EditableRow
            icon="🌱"
            label="Capital growth assumption"
            sublabel="Projection only — never counted as income (§4)"
            displayValue={`${(inputs.capitalGrowthAssumption * 100).toFixed(1)}%`}
            field="capitalGrowthAssumption"
            currentValue={inputs.capitalGrowthAssumption * 100}
            step="0.1"
            suffix="%"
          />
          <ReinvestRow reinvest={inputs.reinvestInvestmentIncome} />
        </Section>

        <Section title="Other engines">
          <EditableRow icon="🚀" label="Side business / hustle income" displayValue={formatAUD(inputs.sideBusinessIncome)} field="sideBusinessIncome" currentValue={inputs.sideBusinessIncome.toNumber()} step="500" suffix="/ yr" />
          <EditableRow icon="🌤️" label="Other passive income" displayValue={formatAUD(inputs.otherPassiveIncome)} field="otherPassiveIncome" currentValue={inputs.otherPassiveIncome.toNumber()} step="500" suffix="/ yr" />
        </Section>

        <Section title="Direction">
          <EditableRow icon="⏳" label="Planning horizon" displayValue={`${inputs.timeHorizonYears} years`} field="timeHorizonYears" currentValue={inputs.timeHorizonYears} step="1" min={1} suffix="yrs" />
          <EditableRow
            icon="🎯"
            label="Target employment dependency"
            sublabel={snapshot.targetEmploymentDependency <= 0 ? "0% = work optional" : undefined}
            displayValue={`${snapshot.targetEmploymentDependency}%`}
            field="targetEmploymentDependency"
            currentValue={snapshot.targetEmploymentDependency}
            step="1"
            suffix="%"
          />
        </Section>

        <Section title="Surplus & contribution">
          <Card padding="p-3" className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm" style={{ background: "var(--color-accent-soft)", color: "var(--color-accent)" }} aria-hidden>
              🧮
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">Available surplus</span>
              <span className="block text-[11px]" style={MUTED}>
                Employment income − lifestyle to fund
              </span>
            </span>
            <span className="shrink-0 text-sm font-semibold">{formatAUD(surplus)}</span>
          </Card>
          <EditableRow
            icon="💸"
            label="Planned annual contribution"
            sublabel="Starts equal to surplus, editable independently"
            displayValue={formatAUD(inputs.plannedAnnualContribution)}
            field="plannedAnnualContribution"
            currentValue={inputs.plannedAnnualContribution.toNumber()}
            step="500"
            suffix="/ yr"
          />
        </Section>

        <Section title="Directional projection">
          <Card padding="p-3">
            <ProjectionChart projection={projection} />
            <div className="mt-3 grid grid-cols-4 gap-1 text-xs">
              <span style={MUTED} />
              {columns.map((c) => (
                <span key={c.label} className="text-center font-semibold">
                  {c.label}
                </span>
              ))}
              <span style={MUTED}>Invested assets</span>
              {columns.map((c) => (
                <span key={c.label} className="text-center">
                  {formatCompactAUD(c.entry.investedAssets)}
                </span>
              ))}
              <span style={MUTED}>Cash-income capacity</span>
              {columns.map((c) => (
                <span key={c.label} className="text-center">
                  {formatCompactAUD(c.entry.investmentIncomeCapacity)}
                </span>
              ))}
            </div>
            <p className="mt-3 text-center text-[10px]" style={MUTED}>
              Today&apos;s dollars. Based on current assumptions. Not a guarantee.
            </p>
          </Card>
        </Section>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="px-1 text-xs font-semibold tracking-wide uppercase" style={MUTED}>
        {title}
      </h3>
      <div className="flex flex-col gap-2">{children}</div>
    </div>
  );
}

function ReinvestRow({ reinvest }: { reinvest: boolean }) {
  return (
    <Card padding="p-3" className="flex items-center gap-2.5">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm" style={{ background: "var(--color-accent-soft)", color: "var(--color-accent)" }} aria-hidden>
        ♻️
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">Reinvest investment income</span>
        <span className="block text-[11px]" style={MUTED}>
          Counts toward capacity either way (§3)
        </span>
      </span>
      <form action={toggleReinvestInvestmentIncome}>
        <input type="hidden" name="reinvest" value={reinvest ? "false" : "true"} />
        <button
          type="submit"
          className="shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold"
          style={{
            background: reinvest ? "var(--status-ahead-soft)" : "var(--color-border)",
            color: reinvest ? "var(--status-ahead)" : "var(--color-text-muted)",
          }}
        >
          {reinvest ? "Yes" : "No"}
        </button>
      </form>
    </Card>
  );
}

/** Minimal hand-coded sparkline of the invested-asset projection — no charting library, just an SVG polyline. */
function ProjectionChart({ projection }: { projection: Awaited<ReturnType<typeof getNorthStarSnapshot>>["projection"] }) {
  const width = 280;
  const height = 72;
  const values = projection.map((p) => p.investedAssets.toNumber());
  const max = Math.max(...values, 1);
  const step = projection.length > 1 ? width / (projection.length - 1) : width;
  const points = values.map((v, i) => `${i * step},${height - (v / max) * height}`).join(" ");

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full" aria-hidden>
      <polyline points={points} fill="none" stroke="var(--color-accent)" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
