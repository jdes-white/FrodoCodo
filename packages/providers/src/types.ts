import type {
  AccountType,
  ConnectionMethod,
  ConsentStatus,
  TransactionDirection,
  TransactionStatus,
} from "@frodocodo/shared";
import type { Money } from "@frodocodo/shared";

/**
 * The internal normalized financial-data interface (§7). The rest of the
 * application talks to this interface only — never to a bank- or
 * aggregator-specific schema — so the aggregator can be swapped (or a
 * second one added) without touching the budgeting engine.
 */

export interface ProviderInstitution {
  providerInstitutionId: string;
  name: string;
  shortName: string;
  /**
   * How this specific institution/product is reachable today. CDR where
   * available; CREDENTIAL_BASED only as a documented fallback until the
   * institution joins the Consumer Data Right (see docs/provider-integration.md
   * for the Amex-specific timeline).
   */
  connectionMethod: ConnectionMethod;
}

export interface ProviderAccount {
  providerAccountId: string;
  displayName: string;
  accountType: AccountType;
  currency: string;
  /**
   * A real provider's account response naturally includes these — kept
   * here so an adapter's shape stays realistic — but Task 6C's
   * data-minimisation review found no currently-required FrodoCodo
   * feature reads a bank balance ("how much is left" is budget-remaining,
   * not account balance) and removed them from the persisted `Account`
   * model and the account ingestion allow-list
   * (`packages/ledger/src/ingestion.ts`). Every ingestion call site reads
   * these off the sync response and then discards them; do not add a code
   * path that persists them.
   */
  currentBalance: Money;
  availableBalance: Money;
}

export interface ProviderTransaction {
  /** Null for some pending transactions on some providers — dedupe must tolerate this (§10). */
  providerTransactionId: string | null;
  accountProviderId: string;
  transactionDate: string; // YYYY-MM-DD
  postingDate: string | null;
  amount: Money; // positive magnitude
  direction: TransactionDirection;
  status: TransactionStatus;
  description: string;
  /** Provider-enriched merchant/category, when available (classification Layer 3, §11). */
  enrichedMerchant?: string;
  enrichedCategory?: string;
  /**
   * A provider's own explicit declaration that this transaction reverses/
   * links to another one, by that other transaction's providerTransactionId
   * (Task 6C reversal-detection hardening — tier-1 evidence, preferred
   * over any amount/date/keyword inference when a source actually
   * supplies it). No adapter in this codebase populates this today.
   */
  reversalOfProviderTransactionId?: string | null;
  /** Preserved verbatim for audit/debugging (§9) — never shown to end users directly. */
  raw?: unknown;
}

export interface ConsentInfo {
  status: ConsentStatus;
  grantedAt?: string;
  expiresAt?: string;
}

export interface ProviderSyncError {
  accountProviderId?: string;
  code: string;
  message: string;
}

export interface ProviderSyncResult {
  accounts: ProviderAccount[];
  transactions: ProviderTransaction[];
  syncedAt: string;
  errors: ProviderSyncError[];
}

export interface InitiateConnectionResult {
  providerConnectionId: string;
  /** Present for CDR/OAuth-style flows the user is redirected through. */
  redirectUrl?: string;
}

/**
 * Every aggregator adapter (MockProvider, BasiqProvider, ...) implements
 * this. Nothing outside packages/providers should import a provider-specific
 * module directly.
 */
export interface FinancialDataProvider {
  readonly id: string;

  listSupportedInstitutions(): Promise<ProviderInstitution[]>;
  /**
   * `existingProviderUserId` lets a caller connect a SECOND (or later)
   * institution to a household's existing provider-level user identity
   * instead of creating a new one — the real-world model for a household
   * connecting both CBA and Virgin Money through the same Basiq user (see
   * docs/basiq-integration.md's multi-institution household model).
   * MockProvider accepts and ignores this parameter since it has no
   * provider-level user concept of its own. Callers resolve this value
   * (e.g. by decoding an existing active connection's providerConnectionId)
   * — `packages/providers` itself has no household/database context to
   * look it up (CLAUDE.md: these packages never import `@frodocodo/db`).
   *
   * `newUserContact` (Task 7A.2): Basiq's real `POST /users` contract
   * requires an email or mobile to create a new provider-level user — this
   * is how a caller supplies that identifier when `existingProviderUserId`
   * is not given. MockProvider accepts and ignores it; BasiqProvider
   * throws rather than sending an invalid/empty request if it's missing
   * and a new user genuinely needs to be created.
   */
  initiateConnection(
    institutionId: string,
    existingProviderUserId?: string,
    newUserContact?: { email?: string; mobile?: string },
  ): Promise<InitiateConnectionResult>;
  getConsentStatus(providerConnectionId: string): Promise<ConsentInfo>;
  discoverAccounts(providerConnectionId: string): Promise<ProviderAccount[]>;
  syncTransactions(
    providerConnectionId: string,
    options: { sinceDate?: string; accountProviderIds?: string[] },
  ): Promise<ProviderSyncResult>;
  disconnectConnection(providerConnectionId: string): Promise<void>;
}
