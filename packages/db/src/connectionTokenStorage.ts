import { encryptForStorage, decryptFromStorage } from "./payloadEncryption.js";
import { prisma } from "./index.js";

/**
 * Task 7A credential/token threat model
 * (docs/basiq-integration.md, docs/banking-data-minimisation-audit.md §8):
 * the only sanctioned path for a provider adapter to persist an
 * access/refresh token against a `FinancialConnection`. Every value is
 * encrypted (`packages/db/src/payloadEncryption.ts`'s AES-256-GCM
 * envelope) before it reaches the database — no adapter, action, or route
 * handler should call `prisma.financialConnection.update` with a token
 * field directly.
 *
 * A token is never logged by this module (and must never be logged by any
 * caller either — see docs/basiq-integration.md's logging section).
 */

export interface ConnectionTokens {
  accessToken: string;
  refreshToken?: string | null;
  /** When the access token expires, if the provider reports one. */
  expiresAt?: Date | null;
}

/** Encrypts and stores a connection's provider token(s). Overwrites whatever was there before. */
export async function storeConnectionTokens(connectionId: string, tokens: ConnectionTokens): Promise<void> {
  await prisma.financialConnection.update({
    where: { id: connectionId },
    data: {
      accessTokenEncrypted: (encryptForStorage(tokens.accessToken) ?? null) as never,
      refreshTokenEncrypted: (encryptForStorage(tokens.refreshToken ?? null) ?? null) as never,
      tokenExpiresAt: tokens.expiresAt ?? null,
    },
  });
}

/**
 * Decrypts and returns a connection's stored token(s), or null fields if
 * none are stored (e.g. MockProvider, or a provider whose session state
 * lives entirely on the provider's own side). Throws if a value is stored
 * but can't be decrypted (missing/wrong key, tampered envelope) — the
 * caller (a sync job) should treat that as a hard failure requiring
 * re-authentication, never fall back to a cached/stale value.
 */
export async function readConnectionTokens(connectionId: string): Promise<ConnectionTokens | null> {
  const connection = await prisma.financialConnection.findUniqueOrThrow({
    where: { id: connectionId },
    select: { accessTokenEncrypted: true, refreshTokenEncrypted: true, tokenExpiresAt: true },
  });

  if (!connection.accessTokenEncrypted) return null;

  return {
    accessToken: decryptFromStorage(connection.accessTokenEncrypted) as string,
    refreshToken: connection.refreshTokenEncrypted ? (decryptFromStorage(connection.refreshTokenEncrypted) as string) : null,
    expiresAt: connection.tokenExpiresAt,
  };
}

/**
 * Revocation/disconnect (Task 7A item 10): clears every stored token field
 * for a connection. Called from the disconnect flow regardless of whether
 * the provider-side revoke call succeeded — a household's decision to
 * disconnect locally must never be blocked by a remote call failing, and a
 * cleared token can't be replayed even if the provider-side revoke didn't
 * take effect for some reason.
 */
export async function clearConnectionTokens(connectionId: string): Promise<void> {
  await prisma.financialConnection.update({
    where: { id: connectionId },
    data: { accessTokenEncrypted: null as never, refreshTokenEncrypted: null as never, tokenExpiresAt: null },
  });
}
