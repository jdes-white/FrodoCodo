import "server-only";
import { prisma } from "@frodocodo/db";
import { deriveDefaultAccountAlias, toIngestibleAccountFields } from "@frodocodo/ledger";
import { getBasiqUserIdFromConnectionId, type ConsentInfo, type FinancialDataProvider } from "@frodocodo/providers";
import { syncConnection } from "@frodocodo/worker";
import { getCategorySuggestionExtractor } from "./categorySuggestionFactory";

/**
 * Task 7C — the DB-touching half of the live-connection flow (the
 * signed-cookie/redirect half lives in `basiqConnectState.ts` and the
 * settings server action / callback route). Kept separate from those so
 * this file can be the one place that actually creates `Account` rows and
 * runs the real sync pipeline, reusing existing, already-tested pieces
 * rather than re-implementing any of them:
 *  - `deriveDefaultAccountAlias`/`toIngestibleAccountFields` — the exact
 *    same Task 6B/6C allow-list functions `packages/db/src/seedHousehold.ts`
 *    uses, so a real Basiq-sourced account is minimised identically to a
 *    seeded mock one.
 *  - `syncConnection` (imported from `@frodocodo/worker` — see that
 *    file's doc comment) — the exact same normalize/dedupe/classify/
 *    reconcile pipeline the worker's own scheduled loop runs, so a
 *    household's first sync and every sync after it go through identical
 *    logic.
 */

/**
 * A household connecting a SECOND (or later) Basiq institution should
 * reuse the FIRST connection's Basiq user rather than create a new one
 * (docs/basiq-integration.md's multi-institution model). `packages/providers`
 * has no household/database context to resolve this itself (CLAUDE.md:
 * it never imports `@frodocodo/db`) — this is that resolution, done here.
 * Returns `null` if the household has no existing Basiq connection yet.
 */
export async function findExistingBasiqUserId(householdId: string): Promise<string | null> {
  const connections = await prisma.financialConnection.findMany({
    where: { householdId, providerName: "basiq" },
    select: { providerConnectionId: true },
  });
  for (const connection of connections) {
    const basiqUserId = getBasiqUserIdFromConnectionId(connection.providerConnectionId);
    if (basiqUserId) return basiqUserId;
  }
  return null;
}

/**
 * Creates `Account` rows for a newly-consented connection from the
 * provider's live account list. Never reads a provider's own
 * nickname/balance/account-number field — every persisted field passes
 * through `toIngestibleAccountFields`'s allow-list first, and the
 * household-facing label always comes from `deriveDefaultAccountAlias`
 * (the institution's short name), never from the provider
 * (docs/banking-data-minimisation-audit.md §3/§5).
 */
export async function establishAccountsForConnection(
  provider: FinancialDataProvider,
  connectionId: string,
  householdId: string,
  institutionShortName: string,
): Promise<void> {
  const connection = await prisma.financialConnection.findUniqueOrThrow({ where: { id: connectionId } });
  const providerAccounts = await provider.discoverAccounts(connection.providerConnectionId);

  const existingAliases = (
    await prisma.account.findMany({
      where: { connection: { householdId } },
      select: { alias: true },
    })
  ).map((a) => a.alias);

  for (const providerAccount of providerAccounts) {
    const alias = deriveDefaultAccountAlias(institutionShortName, providerAccount.accountType, existingAliases);
    existingAliases.push(alias);

    const ingestible = toIngestibleAccountFields({
      sourceAccountId: providerAccount.providerAccountId,
      accountType: providerAccount.accountType,
      currency: providerAccount.currency,
    });

    await prisma.account.upsert({
      where: { connectionId_providerAccountId: { connectionId, providerAccountId: ingestible.providerAccountId } },
      update: {},
      create: {
        connectionId,
        providerAccountId: ingestible.providerAccountId,
        alias,
        accountType: ingestible.accountType,
        currency: ingestible.currency,
        lastSyncedAt: new Date(),
      },
    });
  }
}

/** Persists Basiq's (or any provider's) consent outcome onto the connection row. */
export async function applyConsentStatus(connectionId: string, consent: ConsentInfo): Promise<void> {
  await prisma.financialConnection.update({
    where: { id: connectionId },
    data: {
      consentStatus: consent.status,
      consentGrantedAt: consent.grantedAt ? new Date(consent.grantedAt) : undefined,
      consentExpiresAt: consent.expiresAt ? new Date(consent.expiresAt) : undefined,
      isActive: consent.status === "ACTIVE",
    },
  });
}

/**
 * Runs after a connection's consent is confirmed ACTIVE: establishes its
 * accounts, then runs the real sync pipeline for its first transactions.
 * Idempotent the same way `syncConnection` always is — safe to be the
 * thing a return-from-consent callback calls even if a household somehow
 * double-submits.
 */
export async function completeConnectionSync(
  provider: FinancialDataProvider,
  connectionId: string,
  householdId: string,
  institutionShortName: string,
): Promise<void> {
  await establishAccountsForConnection(provider, connectionId, householdId, institutionShortName);
  await syncConnection(provider, connectionId, getCategorySuggestionExtractor());
}
