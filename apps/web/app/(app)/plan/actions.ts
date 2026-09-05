"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@frodocodo/db";
import { requireAdmin } from "@/lib/session";
import { recordAuditEvent } from "@/lib/audit";

/**
 * Budget allocations are admin-only (§5) — the household member sees the
 * same numbers but doesn't edit them. `requireAdmin()` only proves the
 * caller is an admin of *some* household, not that the IDs below belong to
 * it — `budgetPeriodId` and every `categoryId` arrive from client-controlled
 * form fields (hidden input / input name respectively), so both must be
 * proven to belong to `session.householdId` before any write, or a
 * household admin could upsert allocations onto another household's budget
 * period (security audit finding C1). Fails closed: if either check fails,
 * nothing in the transaction below runs.
 */
export async function updateAllocations(formData: FormData): Promise<void> {
  const session = await requireAdmin();
  const budgetPeriodId = String(formData.get("budgetPeriodId"));

  const ownedBudgetPeriod = await prisma.budgetPeriod.findFirst({
    where: { id: budgetPeriodId, householdId: session.householdId },
    select: { id: true },
  });
  if (!ownedBudgetPeriod) {
    throw new Error("Budget period does not belong to this household.");
  }

  const updates: Array<{ categoryId: string; amount: number }> = [];
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("allocation:")) continue;
    const categoryId = key.slice("allocation:".length);
    const amount = Number(value);
    if (Number.isFinite(amount) && amount >= 0) updates.push({ categoryId, amount });
  }

  if (updates.length > 0) {
    const requestedCategoryIds = new Set(updates.map((u) => u.categoryId));
    const ownedCategories = await prisma.category.findMany({
      where: { id: { in: [...requestedCategoryIds] }, householdId: session.householdId },
      select: { id: true },
    });
    if (ownedCategories.length !== requestedCategoryIds.size) {
      throw new Error("One or more categories do not belong to this household.");
    }
  }

  await prisma.$transaction(
    updates.map((u) =>
      prisma.budgetAllocation.upsert({
        where: { budgetPeriodId_categoryId: { budgetPeriodId, categoryId: u.categoryId } },
        update: { amount: u.amount },
        create: { budgetPeriodId, categoryId: u.categoryId, amount: u.amount },
      }),
    ),
  );

  await recordAuditEvent({
    householdId: session.householdId,
    actorUserId: session.userId,
    action: "UPDATE_BUDGET_ALLOCATIONS",
    entityType: "BudgetPeriod",
    entityId: budgetPeriodId,
    metadata: { updates },
  });

  revalidatePath("/plan");
  revalidatePath("/");
}
