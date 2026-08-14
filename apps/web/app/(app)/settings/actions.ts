"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@frodocodo/db";
import { requireAdmin } from "@/lib/session";
import { recordAuditEvent } from "@/lib/audit";

/** Account inclusion/exclusion is admin-only (§5). */
export async function setAccountIncluded(formData: FormData): Promise<void> {
  const session = await requireAdmin();
  const accountId = String(formData.get("accountId"));
  const included = formData.get("included") === "on";

  await prisma.account.updateMany({
    where: { id: accountId, connection: { householdId: session.householdId } },
    data: { isIncludedInBudget: included },
  });

  await recordAuditEvent({
    householdId: session.householdId,
    actorUserId: session.userId,
    action: included ? "INCLUDE_ACCOUNT" : "EXCLUDE_ACCOUNT",
    entityType: "Account",
    entityId: accountId,
  });

  revalidatePath("/settings");
}

/** §34: disconnecting an institution revokes its consent and stops future syncs. Data already imported stays (household can delete separately). */
export async function disconnectInstitution(formData: FormData): Promise<void> {
  const session = await requireAdmin();
  const connectionId = String(formData.get("connectionId"));

  await prisma.financialConnection.updateMany({
    where: { id: connectionId, householdId: session.householdId },
    data: { isActive: false, consentStatus: "REVOKED" },
  });

  await recordAuditEvent({
    householdId: session.householdId,
    actorUserId: session.userId,
    action: "DISCONNECT_INSTITUTION",
    entityType: "FinancialConnection",
    entityId: connectionId,
  });

  revalidatePath("/settings");
}
