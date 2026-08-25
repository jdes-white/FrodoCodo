import Link from "next/link";
import { formatAUD } from "@frodocodo/shared";
import { resolveBudgetPeriod, isCommitmentDueInPeriod } from "@frodocodo/domain";
import { requireSession } from "@/lib/session";
import { getHousehold } from "@/lib/household";
import { listCommitments, type CommitmentView } from "@/lib/commitments";
import { withRouteTiming } from "@/lib/perf";
import { AddCommitmentCard } from "./AddCommitmentCard";
import { CommitmentCard, type CommitmentCardData } from "./CommitmentCard";

const MUTED = { color: "var(--color-text-muted)" } as const;

/**
 * Upcoming Commitments V1 management page (§3) — reached only by tapping
 * Home's "Coming Up" card, not from the bottom nav (§1: no new navigation
 * section). Deliberately one flat list with inline tap-to-edit rows rather
 * than a Settings-style page of sections.
 */
export default async function CommitmentsPage() {
  const session = await requireSession();
  const [household, commitments] = await withRouteTiming("/commitments", () =>
    Promise.all([getHousehold(session.householdId), listCommitments(session.householdId)]),
  );

  const period = resolveBudgetPeriod(
    { type: household.defaultBudgetPeriodType, anchorDay: household.budgetAnchorDay ?? undefined },
    new Date().toISOString().slice(0, 10),
  );

  const notCompleted = commitments.filter((c) => !c.completedAt);
  const dueThisPeriod = notCompleted.filter((c) => isCommitmentDueInPeriod(c, period));
  const later = notCompleted.filter((c) => !isCommitmentDueInPeriod(c, period));
  const completed = commitments.filter((c) => c.completedAt);

  return (
    <div className="flex flex-col gap-6">
      <Link href="/" className="text-sm" style={MUTED}>
        ← Back to Home
      </Link>

      <div>
        <h1 className="text-xl font-bold">Upcoming commitments</h1>
        <p className="text-sm" style={MUTED}>
          Known bills and payments the household is tracking — both of you can add, edit, or mark these paid.
        </p>
      </div>

      <AddCommitmentCard />

      {dueThisPeriod.length > 0 && <CommitmentSection title={`Due this period (${formatDateRange(period.startDate, period.endDate)})`} commitments={dueThisPeriod} />}
      {later.length > 0 && <CommitmentSection title="Later" commitments={later} />}
      {completed.length > 0 && <CommitmentSection title="Paid" commitments={completed} />}

      {commitments.length === 0 && (
        <p className="text-sm" style={MUTED}>
          No upcoming commitments yet. Add a known bill above and it&apos;ll show up on Home&apos;s Coming Up card.
        </p>
      )}
    </div>
  );
}

function CommitmentSection({ title, commitments }: { title: string; commitments: CommitmentView[] }) {
  return (
    <section>
      <h2 className="mb-2 text-sm font-medium" style={MUTED}>
        {title}
      </h2>
      <div className="flex flex-col gap-2">
        {commitments.map((c) => (
          <CommitmentCard key={c.id} commitment={toCardData(c)} />
        ))}
      </div>
    </section>
  );
}

function toCardData(c: CommitmentView): CommitmentCardData {
  return {
    id: c.id,
    name: c.name,
    amount: c.amount.toNumber(),
    amountDisplay: formatAUD(c.amount),
    expectedDate: c.expectedDate,
    dateDisplay: formatShortDate(c.expectedDate),
    recurrence: c.recurrence,
    completedAt: c.completedAt ? c.completedAt.toISOString() : null,
  };
}

function formatShortDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

function formatDateRange(start: string, end: string): string {
  const fmt = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-AU", { day: "numeric", month: "short", timeZone: "UTC" });
  return `${fmt(start)} – ${fmt(end)}`;
}
