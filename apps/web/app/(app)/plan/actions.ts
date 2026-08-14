"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@frodocodo/db";
import { requireAdmin } from "@/lib/session";
import { recordAuditEvent } from "@/lib/audit";

/** Budget allocations are admin-only (§5) — the household member sees the same numbers but doesn't edit them. */
export async function updateAllocations(formData: FormData): Promise<void> {
  const session = await requireAdmin();
  const budgetPeriodId = String(formData.get("budgetPeriodId"));

  const updates: Array<{ categoryId: string; amount: number }> = [];
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("allocation:")) continue;
    const categoryId = key.slice("allocation:".length);
    const amount = Number(value);
    if (Number.isFinite(amount) && amount >= 0) updates.push({ categoryId, amount });
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
