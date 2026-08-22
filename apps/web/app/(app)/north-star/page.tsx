import { formatAUD, formatCompactAUD } from "@frodocodo/shared";
import { requireSession } from "@/lib/session";
import { getNorthStarSnapshot } from "@/lib/northStar";
import { PagedPanels } from "@/components/PagedPanels";
import { DependencyDial } from "@/components/DependencyDial";
import { StatTile } from "@/components/StatTile";
import { Card } from "@/components/Card";
import { AssumptionsPanel } from "./AssumptionsPanel";

const MUTED = { color: "var(--color-text-muted)" } as const;

export default async function NorthStarPage() {
  const session = await requireSession();
  const snapshot = await getNorthStarSnapshot(session.householdId);

  return (
    <PagedPanels
      panels={[
        <Panel1 key="panel-1" snapshot={snapshot} />,
        <AssumptionsPanel key="panel-2" snapshot={snapshot} />,
      ]}
    />
  );
}

/**
 * "How dependent are we on employment today?" — the North Star hero (§6).
 * Deliberately a directional scoreboard, not a report: the dial + four
 * minimal stats + one short "worth considering" line, nothing more. Every
 * number here traces back to packages/domain/src/northStar.ts (CLAUDE.md
 * rule 1) — this component only formats and lays out what
 * lib/northStar.ts already computed.
 */
function Panel1({ snapshot }: { snapshot: Awaited<ReturnType<typeof getNorthStarSnapshot>> }) {
  const { inputs, independentIncome, dependencyPercent, milestone, worthConsidering } = snapshot;

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
        <DependencyDial
          actualPercent={dependencyPercent}
          milestonePercent={milestone}
          lifestyleTarget={inputs.lifestyleTarget.toNumber()}
          independentIncomeToday={independentIncome.toNumber()}
        />
      </Card>

      <div className="mx-auto grid w-full max-w-sm grid-cols-2 gap-1">
        <StatTile padding="p-1.5" icon="🏡" label="Lifestyle to fund" value={formatAUD(inputs.lifestyleTarget)} sublabel="per year, today's dollars" />
        <StatTile padding="p-1.5" icon="💰" label="Independent income" value={formatAUD(independentIncome)} sublabel="sustainable, per year" />
        <StatTile padding="p-1.5" icon="🧭" label="Dependency" value={`${dependencyPercent.toFixed(1)}%`} sublabel="lower is more independent" />
        <StatTile padding="p-1.5" icon="🚩" label="Next milestone" value={`Below ${milestone}%`} sublabel="10-point automatic step" />
      </div>

      <p className="mx-auto max-w-sm text-center text-xs leading-snug font-medium" style={{ color: "var(--color-accent-strong)" }}>
        {worthConsidering}
      </p>
    </div>
  );
}
