/**
 * Task 7A / docs/basiq-integration.md: the exact, minimum data boundary
 * FrodoCodo requests from Basiq — declared once, here, as constants rather
 * than scattered literal strings through the adapter. Every value below
 * has a documented reason to exist; nothing is added "in case it's useful
 * later" (docs/banking-data-minimisation-audit.md §2).
 *
 * Basiq's own consent model is a "consent policy" configured against the
 * Basiq application (not raw per-request OAuth scope strings passed by
 * this adapter) — see docs/basiq-integration.md for what could and could
 * not be verified about its exact wire format from this environment. What
 * IS fully within this codebase's control, and what these constants
 * enforce, is which Basiq API capabilities the adapter itself ever calls:
 * this file is both the declared intent (for the consent policy a human
 * configures in the Basiq dashboard before any real connection) and the
 * literal allow-list `BasiqHttpClient` checks requests against in tests.
 *
 * A server-side FrodoCodo call to Basiq authenticates with a
 * `scope=SERVER_ACCESS` token — Basiq's own full-access server token type,
 * documented behavior, not a FrodoCodo invention. SERVER_ACCESS is what
 * every management call in this adapter uses; there is no narrower
 * documented alternative for server-to-server calls. Anything narrower
 * than SERVER_ACCESS (Basiq's CLIENT_ACCESS token) is a client-side,
 * browser-facing token type this adapter never issues or holds — see
 * docs/basiq-integration.md.
 */

/** Basiq data clusters (consent-policy permissions) FrodoCodo's consent configuration requests. */
export const BASIQ_REQUESTED_DATA_CLUSTERS = ["accounts", "transactions"] as const;
export type BasiqRequestedDataCluster = (typeof BASIQ_REQUESTED_DATA_CLUSTERS)[number];

/**
 * Data clusters/permissions this adapter must NEVER request or depend on,
 * enumerated explicitly (not just "everything not in the allow-list")
 * so a reviewer — human or test — can see the boundary was considered,
 * not merely assumed. See docs/banking-data-minimisation-audit.md §2 for
 * the full reasoning behind each refusal.
 */
export const BASIQ_REFUSED_DATA_CLUSTERS = [
  "account_details", // full/unmasked account number, BSB, detailed product terms
  "identity", // customer name, address, contact details, DOB
  "payees", // third-party payee names + BSB/account numbers
  "regular_payments", // scheduled payments / direct-debit authority metadata
  "cards", // card number/expiry/CVV-adjacent metadata
  "payments", // payment initiation / money movement — Basiq's aggregation product doesn't offer this, and this adapter must never request it even if a future Basiq product did
] as const;

/** Basiq API token scope this adapter's server-to-server calls authenticate with — see the file doc comment. */
export const BASIQ_SERVER_TOKEN_SCOPE = "SERVER_ACCESS" as const;

/**
 * Fixed CDR/Basiq institution short names this adapter targets — matched
 * against Basiq's live `GET /institutions` response by name (never a
 * hardcoded institution ID; see docs/basiq-integration.md for why the
 * exact ID could not be confirmed from this environment and must be
 * verified once real API access exists).
 */
export const SUPPORTED_INSTITUTION_NAMES = {
  CBA: "Commonwealth Bank",
  VIRGIN: "Virgin Money",
} as const;
