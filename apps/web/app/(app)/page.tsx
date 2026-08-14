import { formatAUD } from "@frodocodo/shared";
import { requireSession } from "@/lib/session";
import { getBudgetSnapshot } from "@/lib/budgetSnapshot";
import { statusLabel, statusColorVar } from "@/lib/statusDisplay";
import { BucketCard } from "@/components/BucketCard";
import { ProgressBar } from "@/components/ProgressBar";

export default async function DashboardPage() {
  const session = await requireSession();
  const snapshot = await getBudgetSnapshot(session.householdId);
  const { totalPacing } = snapshot;

  const paceDelta = totalPacing.expectedSpendToDate.minus(totalPacing.spentToDate); // positive = ahead

  return (
    <div className="flex flex-col gap-6">
      {/* Primary: where do we stand right now (§17) */}
      <section
        className="rounded-3xl border p-6"
        style={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}
      >
        <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
          {formatDateRange(snapshot.period.startDate, snapshot.period.endDate)}
        </p>
        <p className="mt-1 text-4xl font-semibold tracking-tight">{formatAUD(totalPacing.remaining)}</p>
        <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
          remaining of {formatAUD(totalPacing.allocation)}
        </p>

        <div
          className="mt-4 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium"
          style={{ background: `${statusColorVar(totalPacing.pacingStatus)}1a`, color: statusColorVar(totalPacing.pacingStatus) }}
        >
          <span>{statusLabel(totalPacing.pacingStatus)}</span>
          {totalPacing.pacingStatus !== "ON_TRACK" && (
            <span>· {formatAUD(paceDelta.abs())} {paceDelta.isNegative() ? "behind" : "ahead of"} pace</span>
          )}
        </div>

        <div className="mt-5">
          <ProgressBar percent={totalPacing.percentConsumed} colorVar={statusColorVar(totalPacing.pacingStatus)} />
          <p className="mt-2 text-xs" style={{ color: "var(--color-text-muted)" }}>
            {Math.round(totalPacing.percentPeriodElapsed)}% of the period elapsed · {Math.round(totalPacing.percentConsumed)}% of budget used
          </p>
        </div>
      </section>

      {/* Secondary: bucket-level position (§17) */}
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {snapshot.buckets.map((bucket) => (
          <BucketCard key={bucket.bucketId} bucket={bucket} />
        ))}
        {snapshot.buckets.length === 0 && (
          <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
            No budget buckets are set up yet. Head to Plan to allocate this period&apos;s budget.
          </p>
        )}
      </section>

      {/* Supporting info: sync freshness (§8, §17) */}
      <section className="text-xs" style={{ color: "var(--color-text-muted)" }}>
        {snapshot.lastSyncedAt ? (
          <p>Last synced {formatRelativeTime(snapshot.lastSyncedAt)}</p>
        ) : (
          <p>No account has synced yet.</p>
        )}
        {snapshot.staleSyncAccountNames.length > 0 && (
          <p className="mt-1" style={{ color: "var(--status-behind)" }}>
            {snapshot.staleSyncAccountNames.join(", ")} {snapshot.staleSyncAccountNames.length === 1 ? "hasn't" : "haven't"} synced recently — figures may be out of date.
          </p>
        )}
      </section>
    </div>
  );
}

function formatDateRange(start: string, end: string): string {
  const fmt = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-AU", { day: "numeric", month: "short", timeZone: "UTC" });
  return `${fmt(start)} – ${fmt(end)}`;
}

function formatRelativeTime(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const diffHours = Math.round(diffMs / 3_600_000);
  if (diffHours < 1) return "just now";
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.round(diffHours / 24);
  return `${diffDays}d ago`;
}
