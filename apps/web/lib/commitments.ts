import "server-only";
import { prisma } from "@frodocodo/db";
import type { UpcomingCommitment as UpcomingCommitmentRow } from "@frodocodo/db";
import { formatCalendarDate, type CalendarDate, type Money } from "@frodocodo/shared";
import { isCommitmentDueInPeriod, type BudgetPeriodBounds, type CommitmentRecurrence } from "@frodocodo/domain";
import { fromPrismaDecimal } from "./decimal";

export interface CommitmentView {
  id: string;
  name: string;
  amount: Money;
  expectedDate: CalendarDate;
  recurrence: CommitmentRecurrence | null;
  completedAt: Date | null;
}

function toView(row: UpcomingCommitmentRow): CommitmentView {
  return {
    id: row.id,
    name: row.name,
    amount: fromPrismaDecimal(row.amount),
    expectedDate: formatCalendarDate(row.expectedDate),
    recurrence: row.recurrence,
    completedAt: row.completedAt,
  };
}

/**
 * Every commitment the household has ever entered — both users see and can
 * maintain the same list (§3), so this is scoped by householdId only, not
 * by which user created a row. Feeds the /commitments management page.
 * Not-yet-completed items first (oldest expected date first, since those
 * are the most pressing), completed ones after.
 */
export async function listCommitments(householdId: string): Promise<CommitmentView[]> {
  const rows = await prisma.upcomingCommitment.findMany({
    where: { householdId },
    orderBy: [{ completedAt: { sort: "asc", nulls: "first" } }, { expectedDate: "asc" }],
  });
  return rows.map(toView);
}

/**
 * The subset that actually counts toward Home's uncommitted calculation
 * (§4): unpaid and due inside the given budget period. A future
 * commitment beyond the period stays in `listCommitments` but is filtered
 * out here until it rolls into range.
 */
export function commitmentsDueInPeriod(commitments: CommitmentView[], period: BudgetPeriodBounds): CommitmentView[] {
  return commitments
    .filter((c) => isCommitmentDueInPeriod(c, period))
    .sort((a, b) => a.expectedDate.localeCompare(b.expectedDate));
}
