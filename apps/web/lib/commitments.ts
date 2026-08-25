import "server-only";
import { prisma, sanitizeDbError, logDbEvent } from "@frodocodo/db";
import type { UpcomingCommitment as UpcomingCommitmentRow } from "@frodocodo/db";
import { formatCalendarDate, type CalendarDate, type Money } from "@frodocodo/shared";
import { isCommitmentDueInPeriod, type BudgetPeriodBounds, type CommitmentRecurrence } from "@frodocodo/domain";
import { fromPrismaDecimal } from "./decimal";

/**
 * P2021 is Prisma's code for "this table doesn't exist in the connected
 * database" — the exact failure mode when the UpcomingCommitment migration
 * (packages/db/prisma/migrations/20260825111702_add_upcoming_commitments)
 * hasn't been applied yet against a given environment's database.
 * Migrations here are deliberately applied by hand, not on deploy (see
 * CLAUDE.md's "Migrations" section) — so there's an unavoidable window
 * where new code has already shipped but a given database hasn't been
 * migrated. Every commitments entry point (this module and
 * app/(app)/commitments/actions.ts) treats that specific condition as
 * "no commitments yet" rather than an unhandled crash, since Home calls
 * listCommitments() on every single page load — before this guard
 * existed, a not-yet-migrated production database took down the entire
 * app, not just the new feature. Any other error still throws normally.
 */
export function isMissingCommitmentsTableError(error: unknown): boolean {
  return sanitizeDbError(error).prismaCode === "P2021";
}

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
  try {
    const rows = await prisma.upcomingCommitment.findMany({
      where: { householdId },
      orderBy: [{ completedAt: { sort: "asc", nulls: "first" } }, { expectedDate: "asc" }],
    });
    return rows.map(toView);
  } catch (error) {
    if (!isMissingCommitmentsTableError(error)) throw error;
    logDbEvent("upcoming_commitment_table_missing", { householdId });
    return [];
  }
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
