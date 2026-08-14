import { requireSession } from "@/lib/session";
import { getLiveInsights } from "@/lib/insights";
import { AskCoach } from "./AskCoach";

const SEVERITY_LABEL: Record<string, string> = {
  WARNING: "Worth a look",
  NOTICE: "Notable",
  INFO: "FYI",
};

export default async function InsightsPage() {
  const session = await requireSession();
  const insights = await getLiveInsights(session.householdId);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-lg font-semibold">Insights</h1>

      <section className="flex flex-col gap-2">
        {insights.length === 0 && (
          <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
            Nothing notable right now — spending looks steady.
          </p>
        )}
        {insights.map((insight) => (
          <div
            key={insight.dedupeKey}
            className="rounded-2xl border p-4"
            style={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}
          >
            <p className="text-xs font-medium" style={{ color: "var(--color-text-muted)" }}>
              {SEVERITY_LABEL[insight.severity]}
            </p>
            <p className="mt-1 text-sm font-medium">{insight.title}</p>
            <p className="mt-1 text-sm" style={{ color: "var(--color-text-muted)" }}>
              {insight.summary}
            </p>
          </div>
        ))}
      </section>

      <section
        className="rounded-2xl border p-4"
        style={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}
      >
        <h2 className="mb-2 text-sm font-medium">Ask about your budget</h2>
        <AskCoach />
      </section>
    </div>
  );
}
