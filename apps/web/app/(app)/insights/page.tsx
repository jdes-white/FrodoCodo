import { requireSession } from "@/lib/session";
import { getLiveInsights } from "@/lib/insights";
import { AskCoach } from "./AskCoach";
import { Card } from "@/components/Card";
import { PageHeader } from "@/components/PageHeader";

const DEFAULT_SEVERITY = { label: "FYI", catToken: "2" };
const SEVERITY: Record<string, { label: string; catToken: string }> = {
  WARNING: { label: "Worth a look", catToken: "3" },
  NOTICE: { label: "Notable", catToken: "5" },
  INFO: DEFAULT_SEVERITY,
};

export default async function InsightsPage() {
  const session = await requireSession();
  const insights = await getLiveInsights(session.householdId);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Insights" />

      <section className="flex flex-col gap-2">
        {insights.length === 0 && (
          <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
            Nothing notable right now — spending looks steady.
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
