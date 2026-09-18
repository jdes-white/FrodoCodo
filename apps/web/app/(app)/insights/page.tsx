import { requireSession } from "@/lib/session";
import { getLiveInsights } from "@/lib/insights";
import { getBudgetSnapshot } from "@/lib/budgetSnapshot";
import { withRouteTiming } from "@/lib/perf";
import { explainPaceStatus, paceStatusLabel } from "@frodocodo/domain";
import { paceStatusColorVar, paceStatusSoftColorVar } from "@/lib/pacePosition";
import { AskCoach } from "./AskCoach";
import { Card } from "@/components/Card";
import { StatusPill } from "@/components/StatusPill";
import { PageHeader } from "@/components/PageHeader";

const DEFAULT_SEVERITY = { label: "FYI", catToken: "2" };
const SEVERITY: Record<string, { label: string; catToken: string }> = {
  WARNING: { label: "Worth a look", catToken: "3" },
  NOTICE: { label: "Notable", catToken: "5" },
  INFO: DEFAULT_SEVERITY,
};

export default async function InsightsPage() {
  const session = await requireSession();
  const [insights, snapshot] = await withRouteTiming("/insights", () =>
    Promise.all([getLiveInsights(session.householdId), getBudgetSnapshot(session.householdId)]),
  );

  // The household's total pacing, run through the same canonical pace
  // classification (packages/domain/src/pacePosition.ts) that Home's
  // bucket cards and the AI fact sheet use on this exact same
  // `snapshot.totalPacing` object — this page can never describe the same
  // financial position differently than either of those (see
  // pacePosition.ts's module doc comment for why one shared classifier
  // matters here). Home Panel 1's ring is the one deliberate exception:
  // it classifies pace against the flexible-only budget on purpose (a
  // fixed commitment posting on schedule isn't a pacing signal), so it
  // can legitimately show a different status than this total-based one —
  // that's a different question ("how's discretionary spending going?"
  // vs. "how's everything going?"), not a second classification system.
  const explanation = explainPaceStatus(snapshot.totalPacing, "budget");
  const status = explanation.status;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Insights" />

      <Card padding="p-4" className="flex items-center gap-3">
        <StatusPill label={paceStatusLabel(status)} color={paceStatusColorVar(status)} soft={paceStatusSoftColorVar(status)} />
        <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
          {explanation.summary}
        </p>
      </Card>

      <section className="flex flex-col gap-2">
        {insights.length === 0 && (
          <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
            No other notable changes to flag right now.
          </p>
        )}
        {insights.map((insight) => {
          const severity = SEVERITY[insight.severity] ?? DEFAULT_SEVERITY;
          return (
            <Card key={insight.dedupeKey} padding="p-4">
              <span
                className="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold"
                style={{ background: `var(--cat-${severity.catToken}-soft)`, color: `var(--cat-${severity.catToken})` }}
              >
                {severity.label}
              </span>
              <p className="mt-2 text-sm font-medium">{insight.title}</p>
              <p className="mt-1 text-sm" style={{ color: "var(--color-text-muted)" }}>
                {insight.summary}
              </p>
            </Card>
          );
        })}
      </section>

      <Card as="section" padding="p-4">
        <h2 className="mb-2 text-sm font-medium">Ask about your budget</h2>
        <AskCoach />
      </Card>
    </div>
  );
}
