import { randomBytes } from "node:crypto";

/**
 * Basiq's documented hosted Consent UI pattern is a browser redirect to
 * `https://consent.basiq.io/home?token=<user-bound CLIENT_ACCESS token>`.
 * This module only ever BUILDS that URL as a string — it never fetches it,
 * never redirects a browser to it, and is never called from any code path
 * that could run against a real household in this task (Task 7A.1's hard
 * stop: "Do not launch Consent UI in this task"). Every caller must treat
 * the returned URL as containing a live, short-lived, user-bound secret
 * (the token query parameter) and must never log it, include it in an
 * error message, or persist it — see the http client's `getClientAccessToken`,
 * which is likewise never cached/persisted.
 */

const CONSENT_UI_BASE_URL = "https://consent.basiq.io/home";

export interface ConsentUiUrlOptions {
  /** A freshly obtained, user-bound CLIENT_ACCESS token — never a SERVER_ACCESS token. */
  clientToken: string;
  /**
   * Basiq's documented action for a user who already has an active Basiq
   * user/consent and is adding ANOTHER institution connection, rather than
   * completing their first consent — see docs/basiq-integration.md's
   * multi-institution household model. Omit for a household's first
   * institution connection.
   */
  action?: "connect";
  /**
   * A cryptographically strong, unpredictable value this caller generated
   * (see `generateConsentState`) and stored server-side against the
   * in-flight connection attempt, so the return/callback can be verified
   * against it — CSRF/mix-up protection for the redirect round-trip. Never
   * reused across requests.
   */
  state: string;
  /**
   * Task 7A.2: Basiq's current official Consent UI documentation confirms
   * an optional `institutionId` parameter — when the caller already knows
   * which institution the household intends to connect (CBA or Virgin's
   * `providerInstitutionId`, already resolved by `listSupportedInstitutions`),
   * passing it here skips the institution-selection step in the hosted UI.
   * Omit to let the household pick from Basiq's institution list.
   */
  institutionId?: string;
}

/**
 * Builds (but never fetches or navigates to) the hosted Consent UI URL. The
 * `clientToken` and `state` values are placed only in the returned string —
 * this function itself never logs, throws with, or otherwise surfaces the
 * token value in any error path.
 */
export function buildConsentUiUrl(options: ConsentUiUrlOptions): string {
  if (!options.clientToken) {
    throw new Error("buildConsentUiUrl requires a non-empty clientToken.");
  }
  if (!options.state) {
    throw new Error("buildConsentUiUrl requires a non-empty state value.");
  }

  // Param order mirrors Basiq's own documented example
  // (token, action, state) with institutionId appended, per its Consent
  // Parameters reference — query param order has no functional effect,
  // this is purely for fidelity to the documented example.
  const url = new URL(CONSENT_UI_BASE_URL);
  url.searchParams.set("token", options.clientToken);
  if (options.action) {
    url.searchParams.set("action", options.action);
  }
  url.searchParams.set("state", options.state);
  if (options.institutionId) {
    url.searchParams.set("institutionId", options.institutionId);
  }
  return url.toString();
}

/**
 * Generates a cryptographically strong, URL-safe `state` value for binding
 * one Consent UI redirect round-trip to the server-side request that
 * initiated it. 256 bits of entropy (32 random bytes, base64url-encoded) —
 * comfortably beyond what's needed to resist guessing/replay.
 */
export function generateConsentState(): string {
  return randomBytes(32).toString("base64url");
}
