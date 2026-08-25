import type { ReactNode } from "react";
import { formatAUD, percentage, sumMoney } from "@frodocodo/shared";
import { requireSession, getCurrentUser } from "@/lib/session";
import { getBudgetSnapshot, type BucketSnapshot, type FlexibleBudgetSnapshot } from "@/lib/budgetSnapshot";
import { listCommitments, commitmentsDueInPeriod } from "@/lib/commitments";
import { derivePaceDifference, derivePaceStatus, paceStatusLabel, summarizeCommitments, type PacingResult } from "@frodocodo/domain";
import { paceStatusColorVar, paceStatusSoftColorVar, paceGradientColor } from "@/lib/pacePosition";
import { withRouteTiming } from "@/lib/perf";
import { BucketCard } from "@/components/BucketCard";
import { PacingRing } from "@/components/PacingRing";
import { StatusPill } from "@/components/StatusPill";
import { PagedPanels } from "@/components/PagedPanels";
import { ComingUpCard, type ComingUpPreviewItem } from "@/components/ComingUpCard";

const MUTED = { color: "var(--color-text-muted)" } as const;

// Bounds the "Coming Up" preview regardless of how many commitments are
// actually due this period — Home Page 2 must fit one viewport with no
// internal scroll (see Panel2's doc comment), so the widget always shows
// at most this many rows plus a "+N more" summary line.
const COMING_UP_PREVIEW_COUNT = 2;

export default async function DashboardPage() {
  const session = await requireSession();
  const [user, snapshot, commitments] = await withRouteTiming("/", () =>
    Promise.all([getCurrentUser(session), getBudgetSnapshot(session.householdId), listCommitments(session.householdId)]),
  );
  const { totalPacing, flexibleBudget, buckets } = snapshot;
  const firstName = user.name.split(" ")[0] ?? user.name;

  const dueCommitments = commitmentsDueInPeriod(commitments, snapshot.period);
  const commitmentsSummary = summarizeCommitments(totalPacing.remaining, dueCommitments);
  const previewItems: ComingUpPreviewItem[] = dueCommitments.slice(0, COMING_UP_PREVIEW_COUNT).map((c) => ({
    id: c.id,
    name: c.name,
    dateDisplay: formatShortDate(c.expectedDate),
    amountDisplay: formatAUD(c.amount),
  }));
  const overflow = dueCommitments.slice(COMING_UP_PREVIEW_COUNT);
  const overflowAmountDisplay = overflow.length > 0 ? formatAUD(sumMoney(overflow.map((c) => c.amount))) : null;

  return (
    <PagedPanels
      panels={[
        <Panel1
          key="panel-1"
          firstName={firstName}
          periodLabel={formatDateRange(snapshot.period.startDate, snapshot.period.endDate)}
          totalPacing={totalPacing}
          flexibleBudget={flexibleBudget}
        />,
        <Panel2
          key="panel-2"
          buckets={buckets}
          comingUp={
            dueCommitments.length === 0 ? null : (
              <ComingUpCard
                items={previewItems}
                overflowCount={overflow.length}
                overflowAmountDisplay={overflowAmountDisplay}
                committedDisplay={formatAUD(commitmentsSummary.committed)}
                isShortfall={commitmentsSummary.isShortfall}
                uncommittedDisplay={commitmentsSummary.isShortfall ? formatAUD(commitmentsSummary.shortfall) : formatAUD(commitmentsSummary.uncommitted)}
              />
            )
          }
        />,
      ]}
    />
  );
}

/**
 * "Where are we?" — the primary Home experience (§2 of the paginated-home
 * brief). The ring now carries both halves of the pacing question at
 * once — actual spend % of the flexible budget (thick arc) versus
 * expected position % at this point in the period (thin arc + marker,
 * flexibleBudget.expectedSpendToDate — recurring-aware where a category
 * has that, linear elapsed-time otherwise, since only FIXED_COMMITMENT
 * categories currently have a non-linear model and those are excluded
 * from "flexible" by definition) — so the gap between the two arcs
 * communicates pace visually and the old "X% through the period · Y%
 * used" caption underneath is gone.
 *
 * This drives status/color through a *different* calculation than
 * spendPace.ts's SpendPaceStatus (dollar-variance against the whole
 * recurring-aware budget, used elsewhere e.g. Insights) — see
 * packages/domain/src/pacePosition.ts for the percentage-point-difference
 * system this ring specifically uses. The dollar figures in the center
 * (remaining/allocation/days) stay driven by the total budget, unchanged.
 */
function Panel1({
  firstName,
  periodLabel,
  totalPacing,
  flexibleBudget,
}: {
  firstName: string;
  periodLabel: string;
  totalPacing: PacingResult;
  flexibleBudget: FlexibleBudgetSnapshot;
}) {
  const actualPercent = flexibleBudget.percentConsumed;
  const expectedPercent = percentage(flexibleBudget.expectedSpendToDate, flexibleBudget.allocation);
  const difference = derivePaceDifference(actualPercent, expectedPercent);
  const status = derivePaceStatus(difference);
  const color = paceStatusColorVar(status);
  const soft = paceStatusSoftColorVar(status);
  const arcColor = paceGradientColor(difference);

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
          <PacingRing actualPercent={actualPercent} expectedPercent={expectedPercent} colorVar={arcColor}>
            <StatusPill label={paceStatusLabel(status)} color={color} soft={soft} />
            <p className="mt-2 text-4xl font-extrabold tracking-tight">{formatAUD(totalPacing.remaining)}</p>
            <p className="text-xs" style={MUTED}>
              remaining of {formatAUD(totalPacing.allocation)}
            </p>
            <div className="my-1.5 h-px w-8" style={{ background: "var(--color-border)" }} />
            <p className="text-xs font-semibold" style={{ color: "var(--color-accent)" }}>
              {Math.max(totalPacing.daysRemaining, 0)} days to go
            </p>
          </PacingRing>
        </div>
      </div>
    </div>
  );
}

/**
 * "Where's it going?" — the full bucket breakdown (§6), plus (below the
 * buckets) the optional "Coming Up" widget from the Upcoming Commitments
 * V1 spec — known bills still due this period and how much of what's left
 * is already spoken for. `comingUp` arrives pre-rendered (or null) from
 * the page component rather than this function computing it, so the
 * "must fit one viewport, no internal scroll" constraint that already
 * governed the bucket list stays enforced in exactly one place: the
 * caller bounds the widget's preview rows before it ever gets here, and
 * omits it outright for a household with nothing due.
 */
function Panel2({ buckets, comingUp }: { buckets: BucketSnapshot[]; comingUp: ReactNode }) {
  return (
    <div className="flex h-full flex-col justify-center gap-2.5 px-4">
      {buckets.map((bucket) => (
        <BucketCard key={bucket.bucketId} bucket={bucket} />
      ))}
      {buckets.length === 0 && (
        <p className="text-sm" style={MUTED}>
          No budget buckets are set up yet. Head to Plan to allocate this period&apos;s budget.
        </p>
      )}
      {comingUp}
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

function formatShortDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}
