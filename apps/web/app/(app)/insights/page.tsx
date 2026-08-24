import { requireSession } from "@/lib/session";
import { getLiveInsights } from "@/lib/insights";
import { getBudgetSnapshot } from "@/lib/budgetSnapshot";
import { withRouteTiming } from "@/lib/perf";
import { deriveSpendPaceStatus, explainSpendPace, spendPaceLabel } from "@frodocodo/domain";
import { spendPaceColorVar, spendPaceSoftColorVar } from "@/lib/statusDisplay";
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

  // Same status logic Home's Panel 1 uses (packages/domain/src/spendPace.ts)
  // — one shared source of truth for how the household's position is
  // calculated and worded, so this page can't independently describe the
  // same position with different wording than Home does.
  const status = deriveSpendPaceStatus(snapshot.totalPacing);
  const explanation = explainSpendPace(
    {
      variance: snapshot.totalPacing.variance,
      allocation: snapshot.totalPacing.allocation,
      percentPeriodElapsed: snapshot.totalPacing.percentPeriodElapsed,
      percentConsumed: snapshot.flexibleBudget.percentConsumed,
    },
    "flexible budget",
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Insights" />

      <Card padding="p-4" className="flex items-center gap-3">
        <StatusPill label={spendPaceLabel(status)} color={spendPaceColorVar(status)} soft={spendPaceSoftColorVar(status)} />
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
