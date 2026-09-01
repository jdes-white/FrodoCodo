import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@frodocodo/db";
import { createFinancialProvider } from "@frodocodo/providers";
import { requireAdmin } from "@/lib/session";
import { recordAuditEvent } from "@/lib/audit";
import { applyConsentStatus, completeConnectionSync } from "@/lib/basiqConnect";
import { verifyConnectState, CONNECT_STATE_COOKIE_NAME } from "@/lib/basiqConnectState";

/**
 * Task 7C — where Basiq's hosted Consent UI redirects the household's
 * browser back after they finish (or cancel) consent. This URL itself is a
 * human, dashboard-configured setting on the Basiq application (see
 * docs/basiq-integration.md's setup checklist) — Basiq's own docs describe
 * `state` as the one thing a partner passes through and gets back; they do
 * NOT document a machine-trustable "success"/"error" query parameter this
 * route could just read, so this handler deliberately never trusts
 * anything in the URL except `state` (verified against the signed cookie
 * set before the redirect) — the actual outcome is always independently
 * confirmed by calling `getConsentStatus` against Basiq itself.
 *
 * **This is the one step in the whole flow that genuinely cannot be
 * exercised in this environment**: everything up to and including this
 * route's own logic is real, tested code, but nothing here has ever run
 * against an actual Basiq redirect — that requires a live API key, a real
 * Basiq user, and a household actually completing hosted consent in a
 * browser. See docs/basiq-integration.md for exactly what remains
 * environment-dependent.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const session = await requireAdmin();
  const url = new URL(request.url);
  const returnedState = url.searchParams.get("state");

  const cookieStore = await cookies();
  const stateCookie = cookieStore.get(CONNECT_STATE_COOKIE_NAME)?.value;
  cookieStore.delete(CONNECT_STATE_COOKIE_NAME);

  const failure = () => NextResponse.redirect(new URL("/settings?connected=error", request.url));

  if (!returnedState || !stateCookie) return failure();

  const pending = await verifyConnectState(stateCookie);
  if (!pending || pending.state !== returnedState) return failure();

  // Household-scoped lookup — never complete another household's pending
  // connection, even if its connection ID were somehow guessed (CLAUDE.md
  // rule 10).
  const connection = await prisma.financialConnection.findFirst({
    where: { id: pending.connectionId, householdId: session.householdId },
    include: { institution: true },
  });
  if (!connection) return failure();

  const provider = createFinancialProvider();

  let consent;
  try {
    consent = await provider.getConsentStatus(connection.providerConnectionId);
  } catch (err) {
    await recordAuditEvent({
      householdId: session.householdId,
      actorUserId: session.userId,
      action: "COMPLETE_CONNECTION",
      entityType: "FinancialConnection",
      entityId: connection.id,
      metadata: { outcome: "error", reason: err instanceof Error ? err.message : "unknown error" },
    });
    return failure();
  }

  await applyConsentStatus(connection.id, consent);

  if (consent.status !== "ACTIVE") {
    await recordAuditEvent({
      householdId: session.householdId,
      actorUserId: session.userId,
      action: "COMPLETE_CONNECTION",
      entityType: "FinancialConnection",
      entityId: connection.id,
      metadata: { outcome: "error", consentStatus: consent.status },
    });
    return failure();
  }

  await completeConnectionSync(provider, connection.id, session.householdId, connection.institution.shortName);

  await recordAuditEvent({
    householdId: session.householdId,
    actorUserId: session.userId,
    action: "COMPLETE_CONNECTION",
    entityType: "FinancialConnection",
    entityId: connection.id,
    metadata: { outcome: "success" },
  });

  return NextResponse.redirect(new URL("/settings?connected=success", request.url));
}
