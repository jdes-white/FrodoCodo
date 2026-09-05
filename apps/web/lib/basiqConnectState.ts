import { SignJWT, jwtVerify } from "jose";

/**
 * Task 7C: signs/verifies the short-lived `state` handoff used to safely
 * validate Basiq's return from its hosted Consent UI (CSRF/mix-up
 * protection — the `state` value itself comes from
 * `packages/providers`'s `generateConsentState`; this module only signs a
 * small envelope around it so it can round-trip through a cookie without a
 * new database column).
 *
 * Deliberately plain — no `next/headers`, no `"server-only"` import — so
 * this stays unit-testable under apps/web's vitest config (see
 * `vitest.config.ts`'s comment: only lib code with zero Next.js dependency
 * is unit-tested this way). The actual cookie read/write lives in
 * `basiqConnect.ts`/the route handler, which do need `next/headers`.
 */

const ALG = "HS256";
const TTL_SECONDS = 60 * 10; // 10 minutes — long enough to complete Basiq's hosted Consent UI, short enough to not be a standing liability.

export interface PendingConnectState {
  /** The FrodoCodo `FinancialConnection.id` this consent attempt is for. */
  connectionId: string;
  /** The unpredictable value also embedded in the Consent UI URL's `state` query param. */
  state: string;
}

function getSecret(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not configured");
  return new TextEncoder().encode(secret);
}

/** Signs a pending-connect state envelope for storage in a short-lived cookie. */
export async function signConnectState(payload: PendingConnectState): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime(`${TTL_SECONDS}s`)
    .sign(getSecret());
}

/**
 * Verifies a signed pending-connect state token, returning the payload if
 * valid and unexpired, or `null` for anything else (missing, tampered,
 * expired, or malformed) — never throws, since a caller handling Basiq's
 * return should treat any of those uniformly as "can't verify this return,
 * fail closed."
 */
export async function verifyConnectState(token: string): Promise<PendingConnectState | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    if (typeof payload.connectionId !== "string" || typeof payload.state !== "string") return null;
    return { connectionId: payload.connectionId, state: payload.state };
  } catch {
    return null;
  }
}

export const CONNECT_STATE_COOKIE_NAME = "frodocodo_connect_state";
export const CONNECT_STATE_COOKIE_MAX_AGE_SECONDS = TTL_SECONDS;
