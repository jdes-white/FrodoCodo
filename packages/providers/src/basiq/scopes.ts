/**
 * Task 7A.1 correction: Task 7A's original `BASIQ_REQUESTED_DATA_CLUSTERS`
 * conflated two genuinely different Basiq concepts into one list. Basiq v3
 * distinguishes:
 *
 *  1. API AUTHENTICATION TOKEN SCOPE — `SERVER_ACCESS` / `CLIENT_ACCESS`.
 *     This is an OAuth-style scope this adapter DOES send as a literal
 *     request parameter (`scope=SERVER_ACCESS` in the `/token` exchange —
 *     see `httpClient.ts`). It controls which Basiq API *endpoints* the
 *     resulting bearer token can call at all, not what banking data a
 *     household has consented to share.
 *
 *  2. CDR CONSENT POLICY SCOPE — `bank:accounts.basic:read`,
 *     `bank:transactions:read`, etc. This is Basiq's own consent-policy
 *     concept, configured against the Basiq *application* in its
 *     dashboard (a human, pre-live setup step — see
 *     docs/basiq-integration.md's setup checklist), and presented to the
 *     household when they connect an institution. **This adapter's code
 *     never sends these as a request parameter** — there is no documented
 *     Basiq v3 API call where a client passes CDR scope strings directly;
 *     they're a dashboard configuration that determines what the hosted
 *     Consent UI asks the household to approve.
 *
 * Task 7A's `BASIQ_REQUESTED_DATA_CLUSTERS = ["accounts", "transactions"]`
 * was a reasonable *intent* but the wrong *vocabulary* — "accounts"/
 * "transactions" aren't Basiq's real CDR scope strings, and nothing in
 * this adapter ever needed to construct a literal scope request from them
 * (the dashboard configuration is out-of-band). This file now names both
 * concepts separately and correctly, and states plainly which one is
 * actually sent by code (token scope) versus which one is dashboard
 * configuration this file only *documents* the required value of (CDR
 * consent-policy scope).
 */

// ---------- 1. API authentication token scope (sent by this adapter's code) ----------

/** Basiq's own two documented token scope types. This adapter only ever requests SERVER — see the file doc comment for why CLIENT_ACCESS exists at all (Consent UI launch, never held server-side beyond that one use). */
export const BASIQ_TOKEN_SCOPES = {
  /** Full server-to-server API access — used for every management call this adapter makes (institutions, users, connections, accounts, transactions). */
  SERVER: "SERVER_ACCESS",
  /**
   * Restricted, user-bound token type — Basiq's documented restriction is
   * that a CLIENT_ACCESS token only grants Get Institutions/Get
   * Institution Details/Check Job Status/Get User Consents, plus what's
   * needed to launch the hosted Consent UI for that specific user. This
   * adapter obtains one only immediately before building a Consent UI URL
   * (`consentUi.ts`) and never uses it for any other call, never caches
   * it beyond that single use, and never exposes the SERVER token to
   * anything that could reach the browser.
   */
  CLIENT: "CLIENT_ACCESS",
} as const;
export type BasiqTokenScope = (typeof BASIQ_TOKEN_SCOPES)[keyof typeof BASIQ_TOKEN_SCOPES];

/** @deprecated Use `BASIQ_TOKEN_SCOPES.SERVER` — kept only so any stale reference fails to compile rather than silently importing an unrelated name. */
export const BASIQ_SERVER_TOKEN_SCOPE = BASIQ_TOKEN_SCOPES.SERVER;

// ---------- 2. CDR consent-policy scope (dashboard configuration, documented not transmitted) ----------

/**
 * The exact CDR consent-policy scopes FrodoCodo's Basiq application must
 * be configured with — a human, pre-live dashboard step (see
 * docs/basiq-integration.md). No line of code in this adapter sends these
 * strings anywhere; they exist here so the required dashboard
 * configuration is documented as an exact, testable constant instead of
 * prose that could drift from what's actually configured.
 */
export const BASIQ_CONSENT_POLICY_SCOPES = ["bank:accounts.basic:read", "bank:transactions:read"] as const;
export type BasiqConsentPolicyScope = (typeof BASIQ_CONSENT_POLICY_SCOPES)[number];

/**
 * CDR consent-policy scopes FrodoCodo's application must NEVER be
 * configured with, enumerated explicitly (not just "everything not in the
 * allow-list") so a reviewer — human or test — can see the boundary was
 * considered, not merely assumed. See
 * docs/banking-data-minimisation-audit.md §2 for the reasoning behind
 * each refusal. Exact strings per Basiq/CDR's documented naming
 * convention as far as this environment could confirm — see
 * docs/basiq-integration.md's unresolved wire-format items for anything
 * not independently verified.
 */
export const BASIQ_REFUSED_CONSENT_POLICY_SCOPES = [
  "bank:accounts.detail:read", // full/unmasked account number, BSB, detailed product terms
  "common:customer.basic:read", // customer name
  "common:customer.detail:read", // address, contact details, DOB
  "bank:payees:read", // third-party payee names + BSB/account numbers
  "bank:regular_payments:read", // scheduled payments / direct-debit authority metadata
  "bank:products:read", // detailed product/card feature metadata not needed for transaction ingestion
] as const;

// ---------- Institution targeting ----------

/**
 * Fixed CDR/Basiq institution short names this adapter targets — matched
 * against Basiq's live `GET /institutions` response by name (never a
 * hardcoded institution ID; see docs/basiq-integration.md for why the
 * exact ID could not be confirmed from this environment and must be
 * verified once real API access exists). Each entry lists every
 * exact-match name/short-name variant this adapter will accept — deliberately
 * a short, human-reviewed allow-list, not a fuzzy pattern (see
 * institutionMatch.ts).
 */
export const SUPPORTED_INSTITUTIONS = {
  CBA: { shortName: "CBA", approvedNames: ["Commonwealth Bank", "Commonwealth Bank of Australia", "CommBank"] },
  VIRGIN: { shortName: "Virgin", approvedNames: ["Virgin Money", "Virgin Money Australia"] },
} as const;
