import { formatAUD } from "@frodocodo/shared";
import { requireSession, getCurrentUser } from "@/lib/session";
import { getBudgetSnapshot, type BucketSnapshot } from "@/lib/budgetSnapshot";
import { deriveSpendPaceStatus, explainSpendPace, spendPaceLabel, type PacingResult } from "@frodocodo/domain";
import { spendPaceColorVar, spendPaceSoftColorVar } from "@/lib/statusDisplay";
import { BucketCard } from "@/components/BucketCard";
import { ProgressRing } from "@/components/ProgressRing";
import { StatusPill } from "@/components/StatusPill";
import { HomePager } from "@/components/HomePager";

const MUTED = { color: "var(--color-text-muted)" } as const;

export default async function DashboardPage() {
  const session = await requireSession();
  const [user, snapshot] = await Promise.all([getCurrentUser(session), getBudgetSnapshot(session.householdId)]);
  const { totalPacing, flexibleBudget, buckets, lastSyncedAt, staleSyncAccountNames } = snapshot;
  const firstName = user.name.split(" ")[0] ?? user.name;

  return (
    <HomePager
      panels={[
        <Panel1
          key="panel-1"
          firstName={firstName}
          periodLabel={formatDateRange(snapshot.period.startDate, snapshot.period.endDate)}
          totalPacing={totalPacing}
          flexiblePercentConsumed={flexibleBudget.percentConsumed}
          hasAttentionNeeded={staleSyncAccountNames.length > 0}
        />,
        <Panel2
          key="panel-2"
          buckets={buckets}
          lastSyncedAt={lastSyncedAt}
          staleSyncAccountNames={staleSyncAccountNames}
        />,
      ]}
    />
  );
}

/**
 * "Where are we?" — the primary Home experience (§2 of the paginated-home
 * brief). Deliberately sparse: the ring + one caption line is meant to be
 * legible within ~2 seconds, not a dashboard of cards. The ring's color and
 * status pill come from spend *pace* (deriveSpendPaceStatus — is current
 * spending sustainable given how far through the period we are), which is
 * a different question from the dollar figure in the middle (budget
 * *position* — how much money is actually left). See
 * packages/domain/src/spendPace.ts for why those are kept distinct.
 */
function Panel1({
  firstName,
  periodLabel,
  totalPacing,
  flexiblePercentConsumed,
  hasAttentionNeeded,
}: {
  firstName: string;
  periodLabel: string;
  totalPacing: PacingResult;
  flexiblePercentConsumed: number;
  hasAttentionNeeded: boolean;
}) {
  const status = deriveSpendPaceStatus(totalPacing);
  const color = spendPaceColorVar(status);
  const soft = spendPaceSoftColorVar(status);
  // The ring/pill's status is based on the whole budget (now recurring-aware —
  // see budgetSnapshot.ts's expectedSpendToDateOverride), but the explanation
  // caption reports against the *flexible* budget specifically: "42% of
  // flexible budget used" is a more honest read of discretionary spending
  // pace than a figure that includes e.g. a mortgage payment that already
  // posted on schedule.
  const explanation = explainSpendPace(
    { variance: totalPacing.variance, allocation: totalPacing.allocation, percentPeriodElapsed: totalPacing.percentPeriodElapsed, percentConsumed: flexiblePercentConsumed },
    "flexible budget",
  );

  return (
    <div className="flex h-full flex-col justify-center gap-3 px-4">
      <div>
        <h1 className="text-xl font-bold sm:text-2xl">
          {greeting()}, {firstName}! 👋
        </h1>
        <p className="text-sm" style={MUTED}>
          Here&apos;s your financial snapshot
        </p>
      </div>

      <div className="hero-sky mx-auto w-full max-w-sm rounded-3xl border p-5" style={{ borderColor: "var(--color-border)" }}>
        <p className="text-center text-sm font-medium" style={MUTED}>
          {periodLabel}
        </p>
        <div className="mt-2">
          <ProgressRing percent={totalPacing.percentConsumed} colorVar={color}>
            <StatusPill label={spendPaceLabel(status)} color={color} soft={soft} />
            <p className="mt-2 text-4xl font-extrabold tracking-tight">{formatAUD(totalPacing.remaining)}</p>
            <p className="text-xs" style={MUTED}>
              remaining of {formatAUD(totalPacing.allocation)}
            </p>
            <div className="my-1.5 h-px w-8" style={{ background: "var(--color-border)" }} />
            <p className="text-xs font-semibold" style={{ color: "var(--color-accent)" }}>
              {Math.max(totalPacing.daysRemaining, 0)} days to go
            </p>
          </ProgressRing>
        </div>
        <p className="mt-3 text-center text-xs" style={MUTED}>
          {explanation.summary}
        </p>
      </div>

      {hasAttentionNeeded && (
        <div
          className="mx-auto w-full max-w-sm rounded-xl px-3 py-2 text-center text-xs font-medium"
          style={{ background: "var(--status-behind-soft)", color: "var(--status-behind)" }}
        >
          ⚠️ Some accounts haven&apos;t synced recently — figures may be out of date
        </div>
      )}
    </div>
  );
}

/**
 * "Where's it going?" — the full bucket breakdown (§6). Compact enough
 * that this household's four buckets all fit one viewport with no clipped
 * fifth card and no internal scroll (BucketCard was redesigned to a single
 * tight row for this — see components/BucketCard.tsx). A household with
 * substantially more than four buckets isn't accounted for yet; that would
 * need this panel to become scrollable or split further, deliberately
 * deferred rather than guessed at here.
 */
function Panel2({
  buckets,
  lastSyncedAt,
  staleSyncAccountNames,
}: {
  buckets: BucketSnapshot[];
  lastSyncedAt: Date | null;
  staleSyncAccountNames: string[];
}) {
  const stale = staleSyncAccountNames.length > 0;
  return (
    <div className="flex h-full flex-col gap-2 px-4 pt-2 pb-2">
      <h2 className="text-lg font-bold">Where&apos;s it going?</h2>
      <div className="flex flex-col gap-1.5">
        {buckets.map((bucket) => (
          <BucketCard key={bucket.bucketId} bucket={bucket} />
        ))}
        {buckets.length === 0 && (
          <p className="text-sm" style={MUTED}>
            No budget buckets are set up yet. Head to Plan to allocate this period&apos;s budget.
          </p>
        )}
      </div>
      <div
        className="mt-auto flex items-center justify-center gap-1.5 rounded-full px-3 py-1.5 text-center text-xs font-medium"
        style={stale ? { background: "var(--status-behind-soft)", color: "var(--status-behind)" } : MUTED}
      >
        {lastSyncedAt ? (
          <span>
            {stale ? "⚠️ " : "🔄 "}
            {stale ? `${staleSyncAccountNames.join(", ")} ${staleSyncAccountNames.length === 1 ? "hasn't" : "haven't"} synced recently` : `Synced ${formatRelativeTime(lastSyncedAt)}`}
          </span>
        ) : (
          <span>No account has synced yet.</span>
        )}
      </div>
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
