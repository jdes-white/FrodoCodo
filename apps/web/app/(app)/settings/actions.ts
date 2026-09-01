"use server";

import { revalidatePath } from "next/cache";
import { prisma, clearConnectionTokens } from "@frodocodo/db";
import { createFinancialProvider } from "@frodocodo/providers";
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

/**
 * §34 / Task 7A item 10: disconnecting an institution revokes its consent
 * and stops future syncs. Historical transactions and the Account record
 * are preserved (never deleted here) — a household can always reconnect
 * later without losing its budgeting history, and a separate, explicit
 * action would be needed to actually delete data (not built — deleting
 * financial history isn't a side effect of disconnecting a feed).
 *
 * Least-surprising default: the household's decision to disconnect is
 * honored locally regardless of whether the provider-side revoke call
 * succeeds — a remote failure must never leave a connection the household
 * asked to disconnect looking "still active" in FrodoCodo. The
 * provider-side outcome is recorded in the audit event either way, and
 * the stored token (if any) is always cleared, so even a provider-side
 * revoke that silently failed can't be replayed from this app.
 */
export async function disconnectInstitution(formData: FormData): Promise<void> {
  const session = await requireAdmin();
  const connectionId = String(formData.get("connectionId"));

  const connection = await prisma.financialConnection.findFirst({
    where: { id: connectionId, householdId: session.householdId },
    select: { id: true, providerConnectionId: true },
  });
  if (!connection) {
    revalidatePath("/settings");
    return;
  }

  let providerRevoked = false;
  let providerRevokeError: string | undefined;
  try {
    const provider = createFinancialProvider();
    await provider.disconnectConnection(connection.providerConnectionId);
    providerRevoked = true;
  } catch (err) {
    // Never log the connection's provider-specific identifiers or any
    // token — only that a revoke attempt happened and whether it
    // succeeded (Task 7A logging requirements).
    providerRevokeError = err instanceof Error ? err.message : "unknown error";
  }

  await clearConnectionTokens(connection.id);

  await prisma.financialConnection.update({
    where: { id: connection.id },
    data: { isActive: false, consentStatus: "REVOKED" },
  });

  await recordAuditEvent({
    householdId: session.householdId,
    actorUserId: session.userId,
    action: "DISCONNECT_INSTITUTION",
    entityType: "FinancialConnection",
    entityId: connectionId,
    metadata: providerRevoked ? { providerRevoked: true } : { providerRevoked: false, providerRevokeError },
  });

  revalidatePath("/settings");
}
