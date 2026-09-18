/**
 * Basiq API response shapes this adapter reads from. These are a
 * best-effort model of Basiq's documented conventions (a JSON:API-style
 * `{ data: [...], links: { next } }` envelope, confirmed via Basiq's own
 * published API reference summaries) — exact field names could not be
 * verified against Basiq's live API reference from this environment (see
 * docs/basiq-integration.md's unresolved pre-live items). Every field this
 * adapter actually reads is deliberately narrow (an ID, a status string, an
 * amount, a description) — the kind of field unlikely to differ from the
 * documented shape even if some adjacent field name needs correcting once
 * real API access exists. Confirm this file against a real (sandboxed,
 * non-production) Basiq response before the first live connection.
 */

export interface BasiqTokenResponse {
  access_token: string;
  token_type: string;
  /** Seconds until expiry. */
  expires_in: number;
}

export interface BasiqInstitution {
  id: string;
  name: string;
  shortName: string;
  country: string;
}

export interface BasiqAccountAttributes {
  /**
   * Present in Basiq's real response; deliberately never read past
   * existence-checking in tests that prove this adapter's mapping layer
   * discards it (docs/banking-data-minimisation-audit.md §3/§5).
   */
  accountNo?: string;
  name?: string;
  class?: { type?: string };
  currency?: string;
  balance?: string;
  availableFunds?: string;
}

export interface BasiqAccount {
  id: string;
  type: "account";
  attributes: BasiqAccountAttributes;
}

export interface BasiqTransactionAttributes {
  status: "pending" | "posted";
  description: string;
  amount: string; // signed decimal string per Basiq convention
  account: string; // the owning account's Basiq ID
  postDate?: string; // ISO date, present once posted
  transactionDate: string; // ISO date
  /**
   * A source's own explicit declaration that this transaction reverses/
   * links to another one — not confirmed present in Basiq's real schema
   * from this environment; read defensively (optional) and mapped through
   * to NormalizedTransactionInput.reversalOfSourceTransactionId only when
   * actually present (Task 6C/7A — see packages/ledger/src/reversalDetection.ts).
   */
  linkedTransactionId?: string | null;
}

export interface BasiqTransaction {
  id: string;
  type: "transaction";
  attributes: BasiqTransactionAttributes;
}

export interface BasiqListResponse<T> {
  data: T[];
  links?: { next?: string };
}
