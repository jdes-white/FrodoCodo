import { formatAUD, percentage } from "@frodocodo/shared";
import { requireSession, getCurrentUser } from "@/lib/session";
import { getBudgetSnapshot, type BucketSnapshot, type FlexibleBudgetSnapshot } from "@/lib/budgetSnapshot";
import { listCommitments, commitmentsDueWithinDays, type CommitmentView } from "@/lib/commitments";
import { listCategoriesWithBuckets } from "@/lib/categories";
import { derivePaceDifference, derivePaceStatus, paceStatusLabel, summarizeUpcomingWindow, type PacingResult } from "@frodocodo/domain";
import { paceStatusColorVar, paceStatusSoftColorVar, paceGradientColor } from "@/lib/pacePosition";
import { withRouteTiming } from "@/lib/perf";
import { BucketCard, type BucketUpcomingData } from "@/components/BucketCard";
import { PacingRing } from "@/components/PacingRing";
import { StatusPill } from "@/components/StatusPill";
import { PagedPanels } from "@/components/PagedPanels";
import { ViewAllCommitmentsLink } from "@/components/ViewAllCommitmentsLink";
import type { CommitmentCardData } from "@/app/(app)/commitments/CommitmentCard";
import type { CategoryOption } from "@/app/(app)/commitments/CommitmentFormFields";

const MUTED = { color: "var(--color-text-muted)" } as const;

// The Home Page 2 bucket-card integration's rolling look-ahead — always
// exactly this many days from today, independent of the household's
// budget period boundaries (see packages/domain/src/commitments.ts's
// isCommitmentDueWithinWindow doc comment).
const UPCOMING_WINDOW_DAYS = 7;

export default async function DashboardPage() {
  const session = await requireSession();
  const [user, snapshot, commitments, categoryRows] = await withRouteTiming("/", () =>
    Promise.all([
      getCurrentUser(session),
      getBudgetSnapshot(session.householdId),
      listCommitments(session.householdId),
      listCategoriesWithBuckets(session.householdId),
    ]),
  );
  const { totalPacing, flexibleBudget, buckets } = snapshot;
  const firstName = user.name.split(" ")[0] ?? user.name;

  const categories: CategoryOption[] = categoryRows.map((c) => ({ id: c.id, name: c.name, bucketName: c.bucket.name }));

  const dueWithinWindow = commitmentsDueWithinDays(commitments, snapshot.asOf, UPCOMING_WINDOW_DAYS);
  const dueByCategoryId = new Map<string, CommitmentView[]>();
  for (const c of dueWithinWindow) {
    if (!c.categoryId) continue;
    const list = dueByCategoryId.get(c.categoryId) ?? [];
    list.push(c);
    dueByCategoryId.set(c.categoryId, list);
  }

  const upcomingByBucketId = new Map<string, BucketUpcomingData>();
  for (const bucket of buckets) {
    const bucketCategoryIds = bucket.categories.map((c) => c.categoryId);
    const dueInBucket = bucketCategoryIds
      .flatMap((categoryId) => dueByCategoryId.get(categoryId) ?? [])
      .sort((a, b) => a.expectedDate.localeCompare(b.expectedDate));
    const summary = summarizeUpcomingWindow(dueInBucket, snapshot.asOf, UPCOMING_WINDOW_DAYS);
    const firstCategoryId = [...bucket.categories].sort((a, b) => a.name.localeCompare(b.name))[0]?.categoryId;

    upcomingByBucketId.set(bucket.bucketId, {
      totalDisplay: formatAUD(summary.total),
      phrase: summary.phrase,
      items: dueInBucket.map(toCommitmentCardData),
      defaultCategoryId: firstCategoryId,
    });
  }

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
        <Panel2 key="panel-2" buckets={buckets} upcomingByBucketId={upcomingByBucketId} categories={categories} />,
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
 * Status/color come from the same canonical pace classification every
 * other status pill in the app uses (packages/domain/src/pacePosition.ts —
 * see its module doc comment), just fed the flexible-only budget as
 * input: a fixed commitment posting on schedule isn't a pacing signal, so
 * this ring deliberately excludes it, while Insights/bucket cards/the AI
 * classify against their own full pacing instead. That's a difference of
 * *input scope*, not a second status system — the same function, same
 * thresholds, same labels and colors apply either way. The dollar figures
 * in the center (remaining/allocation/days) stay driven by the total
 * budget, unchanged.
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
 * "Where's it going?" — the full bucket breakdown (§6). Each bucket card
 * now carries its own upcoming-commitments due line inline (the Home
 * Page 2 bucket-card integration) instead of a separate "Coming Up" widget
 * summarizing all of them in one place — see BucketCard.tsx. Below the
 * bucket list, a single compact link is the household's entry point into
 * the full /commitments management screen; it's deliberately tiny (see
 * ViewAllCommitmentsLink.tsx) since per-commitment detail already lives in
 * whichever bucket card it belongs to, not here too.
 */
function Panel2({
  buckets,
  upcomingByBucketId,
  categories,
}: {
  buckets: BucketSnapshot[];
  upcomingByBucketId: Map<string, BucketUpcomingData>;
  categories: CategoryOption[];
}) {
  return (
    <div className="flex h-full flex-col justify-center gap-2.5 px-4">
      {buckets.map((bucket) => (
        <BucketCard
          key={bucket.bucketId}
          bucket={bucket}
          upcoming={upcomingByBucketId.get(bucket.bucketId) ?? { totalDisplay: "$0.00", phrase: null, items: [], defaultCategoryId: undefined }}
          categories={categories}
        />
      ))}
      {buckets.length === 0 && (
        <p className="text-sm" style={MUTED}>
          No budget buckets are set up yet. Head to Plan to allocate this period&apos;s budget.
        </p>
      )}
      <ViewAllCommitmentsLink />
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

/** Same shape the /commitments page builds (see its own toCardData) — feeds the CommitmentCard reused inside each bucket's bottom sheet. */
function toCommitmentCardData(c: CommitmentView): CommitmentCardData {
  return {
    id: c.id,
    categoryId: c.categoryId,
    name: c.name,
    amount: c.amount.toNumber(),
    amountDisplay: formatAUD(c.amount),
    expectedDate: c.expectedDate,
    dateDisplay: formatShortDate(c.expectedDate),
    recurrence: c.recurrence,
    completedAt: c.completedAt ? c.completedAt.toISOString() : null,
  };
}
