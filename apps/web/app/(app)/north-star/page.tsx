import { requireSession } from "@/lib/session";
import { getNorthStarSnapshot } from "@/lib/northStar";
import { withRouteTiming } from "@/lib/perf";
import { PagedPanels } from "@/components/PagedPanels";
import { NorthStarHero } from "./NorthStarHero";
import { AssumptionsPanel } from "./AssumptionsPanel";

export default async function NorthStarPage() {
  const session = await requireSession();
  const snapshot = await withRouteTiming("/north-star", () => getNorthStarSnapshot(session.householdId));

  return (
    <PagedPanels
      panels={[
        <NorthStarHero
          key="panel-1"
          lifestyleTarget={snapshot.inputs.lifestyleTarget.toNumber()}
          actualIndependentIncome={snapshot.independentIncome.toNumber()}
          actualDependencyPercent={snapshot.dependencyPercent}
          milestonePercent={snapshot.milestone}
          liveWorthConsidering={snapshot.worthConsidering}
        />,
        <AssumptionsPanel key="panel-2" snapshot={snapshot} />,
      ]}
    />
  );
}
