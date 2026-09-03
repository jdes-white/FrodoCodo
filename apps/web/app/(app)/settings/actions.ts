"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { prisma, clearConnectionTokens } from "@frodocodo/db";
import { createFinancialProvider, beginBasiqConsent, getBasiqUserIdFromConnectionId } from "@frodocodo/providers";
import { requireAdmin, getCurrentUser } from "@/lib/session";
import { recordAuditEvent } from "@/lib/audit";
import { findExistingBasiqUserId, applyConsentStatus, completeConnectionSync } from "@/lib/basiqConnect";
import { signConnectState, CONNECT_STATE_COOKIE_NAME, CONNECT_STATE_COOKIE_MAX_AGE_SECONDS } from "@/lib/basiqConnectState";
import { recategorizeScreenshotImportBatch, type RecategorizationSummary } from "@/lib/recategorizeScreenshotBatch";

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
 * Task 7C — the minimum live-connection flow: choose an institution,
 * initiate/reuse the Basiq user, and either hand the household off to
 * Basiq's hosted Consent UI (real providers) or finish immediately
 * (MockProvider, which has no hosted consent step at all — see
 * `MockProvider.initiateConnection`'s consent, which is `ACTIVE`
 * immediately). Admin-only (§5/§11), matching `disconnectInstitution`.
 *
 * Uses the connecting admin's own FrodoCodo login email
 * (`User.email`, already collected for authentication) as Basiq's
 * required `newUserContact.email` — the minimum-new-data option: no
 * mobile number, name, DOB, or address is ever sent, and this email is
 * never additionally persisted anywhere on `FinancialConnection`/`Account`
 * — it's used only for this one outbound `POST /users` call (see
 * `packages/providers/src/basiq/basiqProvider.ts`'s `initiateConnection`).
 */
export async function connectInstitution(formData: FormData): Promise<void> {
  const session = await requireAdmin();
  const providerInstitutionId = String(formData.get("providerInstitutionId") ?? "");

  const provider = createFinancialProvider();
  const institutions = await provider.listSupportedInstitutions();
  const institution = institutions.find((i) => i.providerInstitutionId === providerInstitutionId);
  if (!institution) {
    revalidatePath("/settings");
    return;
  }

  const existingProviderUserId = await findExistingBasiqUserId(session.householdId);
  const newUserContact =
    provider.id === "basiq" && !existingProviderUserId ? { email: (await getCurrentUser(session)).email } : undefined;

  const { providerConnectionId } = await provider.initiateConnection(providerInstitutionId, existingProviderUserId ?? undefined, newUserContact);

  const institutionRow = await prisma.financialInstitution.upsert({
    where: { providerName_providerInstitutionId: { providerName: provider.id, providerInstitutionId } },
    update: {},
    create: {
      name: institution.name,
      shortName: institution.shortName,
      supportedConnectionMethod: institution.connectionMethod,
      providerInstitutionId,
      providerName: provider.id,
    },
  });

  const connection = await prisma.financialConnection.create({
    data: {
      householdId: session.householdId,
      institutionId: institutionRow.id,
      providerName: provider.id,
      providerConnectionId,
      connectionMethod: institution.connectionMethod,
      consentStatus: "PENDING",
      isActive: false,
    },
  });

  await recordAuditEvent({
    householdId: session.householdId,
    actorUserId: session.userId,
    action: "INITIATE_CONNECTION",
    entityType: "FinancialConnection",
    entityId: connection.id,
    metadata: { providerInstitutionId, institutionShortName: institution.shortName, reusedExistingProviderUser: Boolean(existingProviderUserId) },
  });

  if (provider.id !== "basiq") {
    // No hosted consent step for this provider (MockProvider) — the
    // connection is immediately usable. A real, non-CDR credential-based
    // provider (e.g. a future Amex adapter) would follow the same
    // immediate-finish branch only if it likewise has no hosted redirect.
    const consent = await provider.getConsentStatus(providerConnectionId);
    await applyConsentStatus(connection.id, consent);
    if (consent.status === "ACTIVE") {
      await completeConnectionSync(provider, connection.id, session.householdId, institution.shortName);
    }
    revalidatePath("/settings");
    redirect(consent.status === "ACTIVE" ? "/settings?connected=success" : "/settings?connected=error");
  }

  // Basiq: obtain a transient CLIENT_ACCESS token and redirect to the
  // hosted Consent UI. The token and the URL that embeds it are never
  // logged, stored, or returned to this action's caller in any form other
  // than the redirect itself (see beginBasiqConsent's doc comment).
  const basiqUserId = existingProviderUserId ?? getBasiqUserIdFromConnectionIdOrThrow(providerConnectionId);
  const { url, state } = await beginBasiqConsent(basiqUserId, {
    action: existingProviderUserId ? "connect" : undefined,
    institutionId: providerInstitutionId,
  });

  const stateToken = await signConnectState({ connectionId: connection.id, state });
  const cookieStore = await cookies();
  cookieStore.set(CONNECT_STATE_COOKIE_NAME, stateToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/basiq",
    maxAge: CONNECT_STATE_COOKIE_MAX_AGE_SECONDS,
  });

  redirect(url);
}

function getBasiqUserIdFromConnectionIdOrThrow(providerConnectionId: string): string {
  const id = getBasiqUserIdFromConnectionId(providerConnectionId);
  if (!id) throw new Error("Expected a Basiq-encoded providerConnectionId immediately after BasiqProvider.initiateConnection.");
  return id;
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

/**
 * TEMPORARY, ONE-OFF — see `@/lib/recategorizeScreenshotBatch`'s doc
 * comment. Admin-only (§5/§11), same as every other mutation on this page.
 * Called directly from a client component (not a `<form action>`) so the
 * result can be shown inline immediately, without a page reload — this is
 * a maintenance report, not a navigation.
 */
export async function runScreenshotBatchRecategorization(): Promise<RecategorizationSummary> {
  const session = await requireAdmin();
  const summary = await recategorizeScreenshotImportBatch(session.householdId);
  revalidatePath("/transactions");
  revalidatePath("/");
  revalidatePath("/insights");
  return summary;
}
