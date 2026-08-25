"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@frodocodo/db";
import { formatCalendarDate } from "@frodocodo/shared";
import { nextRecurrenceDate, type CommitmentRecurrence } from "@frodocodo/domain";
import { requireSession } from "@/lib/session";
import { recordAuditEvent } from "@/lib/audit";
import { isMissingCommitmentsTableError } from "@/lib/commitments";

/**
 * Upcoming Commitments V1 (§3): manually maintained by either household
 * user, not admin-gated — this is a shared household forecast list like
 * North Star's assumptions, not a control like budget allocation edits.
 *
 * Every action below no-ops (rather than throwing) if the
 * UpcomingCommitment table doesn't exist yet in the connected database —
 * see isMissingCommitmentsTableError's doc comment in lib/commitments.ts.
 * These are fire-and-forget client calls with no error UI to surface a
 * throw to anyway, so a silent no-op is the correct degrade: the page
 * that called this already rendered from listCommitments()'s own P2021
 * guard, and revalidating after a no-op write is harmless.
 */

function parseRecurrence(value: FormDataEntryValue | null): CommitmentRecurrence | null {
  return value === "WEEKLY" || value === "FORTNIGHTLY" || value === "MONTHLY" ? value : null;
}

function parseAmount(value: FormDataEntryValue | null): number | null {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

export async function addCommitment(formData: FormData): Promise<void> {
  const session = await requireSession();
  const name = String(formData.get("name") ?? "").trim();
  const amount = parseAmount(formData.get("amount"));
  const expectedDate = String(formData.get("expectedDate") ?? "");
  const recurrence = parseRecurrence(formData.get("recurrence"));
  if (!name || !amount || !expectedDate) return;

  try {
    const created = await prisma.upcomingCommitment.create({
      data: {
        householdId: session.householdId,
        name,
        amount,
        expectedDate: new Date(expectedDate),
        recurrence,
        createdByUserId: session.userId,
      },
    });

    await recordAuditEvent({
      householdId: session.householdId,
      actorUserId: session.userId,
      action: "ADD_COMMITMENT",
      entityType: "UpcomingCommitment",
      entityId: created.id,
      metadata: { name, amount, expectedDate, recurrence },
    });
  } catch (error) {
    if (!isMissingCommitmentsTableError(error)) throw error;
  }

  revalidatePath("/commitments");
  revalidatePath("/");
}

export async function updateCommitment(formData: FormData): Promise<void> {
  const session = await requireSession();
  const id = String(formData.get("id"));
  const name = String(formData.get("name") ?? "").trim();
  const amount = parseAmount(formData.get("amount"));
  const expectedDate = String(formData.get("expectedDate") ?? "");
  const recurrence = parseRecurrence(formData.get("recurrence"));
  if (!name || !amount || !expectedDate) return;

  try {
    const { count } = await prisma.upcomingCommitment.updateMany({
      where: { id, householdId: session.householdId },
      data: { name, amount, expectedDate: new Date(expectedDate), recurrence },
    });
    if (count === 0) return;

    await recordAuditEvent({
      householdId: session.householdId,
      actorUserId: session.userId,
      action: "UPDATE_COMMITMENT",
      entityType: "UpcomingCommitment",
      entityId: id,
      metadata: { name, amount, expectedDate, recurrence },
    });
  } catch (error) {
    if (!isMissingCommitmentsTableError(error)) throw error;
  }

  revalidatePath("/commitments");
  revalidatePath("/");
}

export async function deleteCommitment(formData: FormData): Promise<void> {
  const session = await requireSession();
  const id = String(formData.get("id"));

  try {
    const { count } = await prisma.upcomingCommitment.deleteMany({ where: { id, householdId: session.householdId } });
    if (count === 0) return;

    await recordAuditEvent({
      householdId: session.householdId,
      actorUserId: session.userId,
      action: "DELETE_COMMITMENT",
      entityType: "UpcomingCommitment",
      entityId: id,
    });
  } catch (error) {
    if (!isMissingCommitmentsTableError(error)) throw error;
  }

  revalidatePath("/commitments");
  revalidatePath("/");
}

/**
 * Marks a commitment paid. If it has a recurrence, this also creates the
 * next occurrence (§5's cheap manual recurrence) — the completed row stays
 * as history, a fresh row picks up the next expected date, and neither of
 * this ever touches the Transaction ledger (§4: a commitment is a
 * forecast item, a transaction is something that actually happened).
 */
export async function completeCommitment(formData: FormData): Promise<void> {
  const session = await requireSession();
  const id = String(formData.get("id"));

  try {
    const commitment = await prisma.upcomingCommitment.findFirst({ where: { id, householdId: session.householdId } });
    if (!commitment || commitment.completedAt) return;

    await prisma.upcomingCommitment.update({ where: { id }, data: { completedAt: new Date() } });

    await recordAuditEvent({
      householdId: session.householdId,
      actorUserId: session.userId,
      action: "COMPLETE_COMMITMENT",
      entityType: "UpcomingCommitment",
      entityId: id,
    });

    if (commitment.recurrence) {
      const nextDate = nextRecurrenceDate(formatCalendarDate(commitment.expectedDate), commitment.recurrence);
      const created = await prisma.upcomingCommitment.create({
        data: {
          householdId: session.householdId,
          name: commitment.name,
          amount: commitment.amount,
          expectedDate: new Date(nextDate),
          recurrence: commitment.recurrence,
          createdByUserId: session.userId,
        },
      });

      await recordAuditEvent({
        householdId: session.householdId,
        actorUserId: session.userId,
        action: "CREATE_RECURRING_COMMITMENT",
        entityType: "UpcomingCommitment",
        entityId: created.id,
        metadata: { fromCommitmentId: id, expectedDate: nextDate },
      });
    }
  } catch (error) {
    if (!isMissingCommitmentsTableError(error)) throw error;
  }

  revalidatePath("/commitments");
  revalidatePath("/");
}
