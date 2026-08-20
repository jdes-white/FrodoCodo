import { formatAUD } from "@frodocodo/shared";
import { requireSession, getCurrentUser } from "@/lib/session";
import { getBudgetSnapshot } from "@/lib/budgetSnapshot";
import { statusLabel, statusColorVar, statusSoftColorVar } from "@/lib/statusDisplay";
import { BucketCard } from "@/components/BucketCard";
import { ProgressRing } from "@/components/ProgressRing";
import { StatTile } from "@/components/StatTile";
import { StatusPill } from "@/components/StatusPill";

export default async function DashboardPage() {
  const session = await requireSession();
  const [user, snapshot] = await Promise.all([getCurrentUser(session), getBudgetSnapshot(session.householdId)]);
  const { totalPacing } = snapshot;

  const paceDelta = totalPacing.expectedSpendToDate.minus(totalPacing.spentToDate); // positive = ahead
  const firstName = user.name.split(" ")[0];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">
          {greeting()}, {firstName}! 👋
        </h1>
        <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
          Here&apos;s your financial snapshot
        </p>
      </div>

      {/* Primary: where do we stand right now (§17) */}
      <section className="hero-sky rounded-3xl border p-6" style={{ borderColor: "var(--color-border)" }}>
        <p className="text-center text-sm font-medium" style={{ color: "var(--color-text-muted)" }}>
          {formatDateRange(snapshot.period.startDate, snapshot.period.endDate)}
        </p>
        <div className="mt-3">
          <ProgressRing percent={totalPacing.percentConsumed} colorVar={statusColorVar(totalPacing.pacingStatus)}>
            <StatusPill
              label={statusLabel(totalPacing.pacingStatus)}
              color={statusColorVar(totalPacing.pacingStatus)}
              soft={statusSoftColorVar(totalPacing.pacingStatus)}
            />
            <p className="mt-2 text-4xl font-extrabold tracking-tight">{formatAUD(totalPacing.remaining)}</p>
            <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
              remaining of {formatAUD(totalPacing.allocation)}
            </p>
            <div className="my-2 h-px w-8" style={{ background: "var(--color-border)" }} />
            <p className="text-xs font-semibold" style={{ color: "var(--color-accent)" }}>
              {Math.max(totalPacing.daysRemaining, 0)} days to go
            </p>
          </ProgressRing>
        </div>
        {totalPacing.pacingStatus !== "ON_TRACK" && (
          <p className="mt-4 text-center text-xs" style={{ color: "var(--color-text-muted)" }}>
            {formatAUD(paceDelta.abs())} {paceDelta.isNegative() ? "behind" : "ahead of"} pace
          </p>
        )}
      </section>

      {/* Three-up snapshot tiles */}
      <section className="flex gap-3">
        <StatTile icon="👛" label="Budget" value={formatAUD(totalPacing.allocation)} sublabel="Total this period" />
        <StatTile
          icon="🥧"
          label="Spent"
          value={formatAUD(totalPacing.spentToDate)}
          sublabel={`${Math.round(totalPacing.percentConsumed)}% of budget`}
        />
        <StatTile icon="%" label="Used" value={`${Math.round(totalPacing.percentConsumed)}%`} sublabel="of budget" />
      </section>

      {/* Secondary: bucket-level position (§17) */}
      <section>
        <h2 className="mb-3 text-sm font-semibold" style={{ color: "var(--color-text-muted)" }}>
          Buckets
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {snapshot.buckets.map((bucket) => (
            <BucketCard key={bucket.bucketId} bucket={bucket} />
          ))}
        </div>
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

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
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
