import { toMoney } from "@frodocodo/shared";
import type { AccountType, TransactionDirection, TransactionStatus } from "@frodocodo/shared";
import { BasiqHttpClient } from "./httpClient.js";
import { findSupportedInstitutions } from "./institutionMatch.js";
import type { BasiqAccount, BasiqInstitution, BasiqTransaction } from "./types.js";
import type {
  ConsentInfo,
  FinancialDataProvider,
  InitiateConnectionResult,
  ProviderAccount,
  ProviderInstitution,
  ProviderSyncResult,
  ProviderTransaction,
} from "../types.js";

/**
 * Real Basiq adapter for CBA + Virgin Money only (Task 7A). Implements
 * exactly `FinancialDataProvider` — the same interface MockProvider
 * implements — so nothing outside packages/providers changes to use it
 * (§7). Amex is deliberately not supported here (still non-CDR; see
 * docs/banking-data-minimisation-audit.md).
 *
 * Every method here is READ-ONLY by construction: this class has no
 * method for payments, transfers, payee creation, account modification, or
 * card operations, and never will — see the "read-only method surface"
 * test in packages/providers/src/basiq/__tests__/basiqProvider.test.ts,
 * which asserts the class's own method surface never grows beyond
 * `FinancialDataProvider`.
 *
 * NEVER instantiate this against a real Basiq API key and call it for
 * real from this codebase — this task's hard stop. Every test exercising
 * this class injects a mock HTTP client; none contact api.basiq.io.
 *
 * See docs/basiq-integration.md for the full architecture writeup, the
 * exact scope boundary, the token security design, and every item that
 * could not be verified against live Basiq documentation from this
 * environment (do not treat any endpoint path, field name, or status
 * value below as confirmed — they are a best-effort, clearly-flagged
 * model of Basiq's publicly documented conventions).
 */
export class BasiqProvider implements FinancialDataProvider {
  readonly id = "basiq";

  constructor(private readonly http: BasiqHttpClient) {}

  async listSupportedInstitutions(): Promise<ProviderInstitution[]> {
    const institutions = await this.http.getAllPages<BasiqInstitution>("/institutions");
    const { cba, virgin } = findSupportedInstitutions(institutions);

    const result: ProviderInstitution[] = [];
    if (cba) result.push({ providerInstitutionId: cba.id, name: cba.name, shortName: "CBA", connectionMethod: "CDR" });
    if (virgin) result.push({ providerInstitutionId: virgin.id, name: virgin.name, shortName: "Virgin", connectionMethod: "CDR" });
    return result;
  }

  /**
   * Creates (or reuses) a Basiq user, creates a connection under it, and
   * returns an encoded providerConnectionId
   * (`basiq::<basiqUserId>::<basiqConnectionId>`), mirroring MockProvider's
   * own encoding convention so every later call
   * (getConsentStatus/discoverAccounts/syncTransactions/disconnectConnection)
   * can recover both IDs from the one string this interface passes around.
   *
   * Task 7A.1 correction (item 4): a household connecting a SECOND
   * institution (e.g. Virgin after CBA) must reuse the FIRST connection's
   * Basiq user rather than create a second one — Basiq's model is one user
   * per end customer, with multiple institution connections underneath.
   * `existingProviderUserId` is how a caller (which does have household
   * context — see `getBasiqUserIdFromConnectionId` below) supplies that
   * reuse; when present, this method skips `POST /users` entirely and
   * creates the connection directly under the existing user.
   *
   * `redirectUrl` is intentionally omitted: this method itself never
   * launches or links to the Consent UI (see `consentUi.ts` — building
   * that URL requires a CLIENT_ACCESS token, obtained separately, and is
   * deliberately not wired into this call). Never guess a URL a real
   * household would be redirected to.
   */
  async initiateConnection(institutionId: string, existingProviderUserId?: string): Promise<InitiateConnectionResult> {
    const basiqUserId = existingProviderUserId ?? (await this.http.post<{ id: string }>("/users", {})).id;
    const connection = await this.http.post<{ id: string }>(`/users/${basiqUserId}/connections`, {
      institution: { id: institutionId },
    });
    return { providerConnectionId: encodeProviderConnectionId(basiqUserId, connection.id) };
  }

  async getConsentStatus(providerConnectionId: string): Promise<ConsentInfo> {
    const { basiqUserId, basiqConnectionId } = decodeProviderConnectionId(providerConnectionId);
    const connection = await this.http.get<{
      attributes: { status?: string; createdDate?: string; expiryDate?: string };
    }>(`/users/${basiqUserId}/connections/${basiqConnectionId}`);

    return {
      status: mapConnectionStatus(connection.attributes.status),
      grantedAt: connection.attributes.createdDate,
      expiresAt: connection.attributes.expiryDate,
    };
  }

  async discoverAccounts(providerConnectionId: string): Promise<ProviderAccount[]> {
    const { basiqUserId } = decodeProviderConnectionId(providerConnectionId);
    const accounts = await this.http.getAllPages<BasiqAccount>(`/users/${basiqUserId}/accounts`);
    return accounts.filter(isValidBasiqAccount).map(mapBasiqAccount);
  }

  async syncTransactions(
    providerConnectionId: string,
    options: { sinceDate?: string; accountProviderIds?: string[] },
  ): Promise<ProviderSyncResult> {
    const { basiqUserId, basiqConnectionId } = decodeProviderConnectionId(providerConnectionId);

    // Best-effort server-side filter using Basiq's documented filter field
    // names for this endpoint (`connection.id`, `account.id`,
    // `transaction.postDate` — see docs/basiq-integration.md's unresolved
    // wire-format items for exactly which of these Basiq's filter grammar
    // actually accepts on `/users/{userId}/transactions`, since that could
    // not be confirmed from this environment). Scoping to this
    // connection's ID keeps the request from pulling every transaction the
    // Basiq user has ever synced, including from other institutions.
    // `limit=500` matches Basiq's documented maximum page size. The
    // in-memory filters below are the actual correctness guarantee
    // regardless of whether any of this is honoured server-side.
    const filters: string[] = [`connection.id.eq('${basiqConnectionId}')`];
    if (options.sinceDate) filters.push(`transaction.postDate.gte('${options.sinceDate}')`);
    const query = `?limit=500&filter=${encodeURIComponent(filters.join(","))}`;

    const rawTransactions = await this.http.getAllPages<BasiqTransaction>(`/users/${basiqUserId}/transactions${query}`);

    const accountFilter = options.accountProviderIds ? new Set(options.accountProviderIds) : null;
    const transactions = rawTransactions
      .filter(isValidBasiqTransaction)
      .filter((t) => !accountFilter || accountFilter.has(t.attributes.account))
      .filter((t) => !options.sinceDate || (t.attributes.postDate ?? t.attributes.transactionDate) >= options.sinceDate)
      .map(mapBasiqTransaction);

    return { accounts: [], transactions, syncedAt: new Date().toISOString(), errors: [] };
  }

  async disconnectConnection(providerConnectionId: string): Promise<void> {
    const { basiqUserId, basiqConnectionId } = decodeProviderConnectionId(providerConnectionId);
    await this.http.delete(`/users/${basiqUserId}/connections/${basiqConnectionId}`);
  }
}

const ID_PREFIX = "basiq";
const ID_SEPARATOR = "::";

function encodeProviderConnectionId(basiqUserId: string, basiqConnectionId: string): string {
  return [ID_PREFIX, basiqUserId, basiqConnectionId].join(ID_SEPARATOR);
}

function decodeProviderConnectionId(providerConnectionId: string): { basiqUserId: string; basiqConnectionId: string } {
  const parts = providerConnectionId.split(ID_SEPARATOR);
  if (parts.length !== 3 || parts[0] !== ID_PREFIX) {
    throw new Error("Not a recognized Basiq provider connection ID.");
  }
  return { basiqUserId: parts[1]!, basiqConnectionId: parts[2]! };
}

/**
 * Extracts the Basiq user ID from an existing Basiq providerConnectionId,
 * for a caller (e.g. apps/web's connection-initiation flow) that wants to
 * connect a household's SECOND institution under the SAME Basiq user
 * rather than creating a new one (see `initiateConnection`'s
 * `existingProviderUserId` parameter above). Returns `null` for a
 * providerConnectionId that isn't a recognized Basiq encoding (e.g. a mock
 * connection ID) instead of throwing — callers are expected to look this
 * up across a household's existing connections and simply skip any that
 * aren't Basiq's.
 */
export function getBasiqUserIdFromConnectionId(providerConnectionId: string): string | null {
  try {
    return decodeProviderConnectionId(providerConnectionId).basiqUserId;
  } catch {
    return null;
  }
}

function mapConnectionStatus(status: string | undefined): ConsentInfo["status"] {
  switch (status) {
    case "active":
      return "ACTIVE";
    case "pending":
      return "PENDING";
    case "expired":
      return "EXPIRED";
    case "cancelled":
    case "revoked":
      return "REVOKED";
    default:
      return "PENDING";
  }
}

/**
 * Task 7A.1 item 8: Basiq's responses are untrusted external input and
 * must be validated at this adapter boundary before normalization —
 * malformed or missing-required-field entries must be skipped (fail safe)
 * rather than silently produce a garbage `ProviderAccount`/`ProviderTransaction`
 * (e.g. a `NaN` amount from `toMoney(undefined)`, or an empty `id` breaking
 * downstream dedup). Only the fields this adapter actually depends on for
 * a correct mapping are checked — the exact optional/required shape of
 * every other field remains unverified (see types.ts's doc comment and
 * docs/basiq-integration.md's unresolved wire-format items).
 */
function isValidBasiqAccount(account: BasiqAccount): boolean {
  return typeof account?.id === "string" && account.id.length > 0;
}

function isValidBasiqTransaction(transaction: BasiqTransaction): boolean {
  return (
    typeof transaction?.id === "string" &&
    transaction.id.length > 0 &&
    typeof transaction.attributes?.account === "string" &&
    transaction.attributes.account.length > 0 &&
    typeof transaction.attributes.amount === "string" &&
    /^-?\d+(\.\d+)?$/.test(transaction.attributes.amount.trim()) &&
    typeof transaction.attributes.transactionDate === "string" &&
    transaction.attributes.transactionDate.length > 0 &&
    typeof transaction.attributes.description === "string"
  );
}

/**
 * Maps a Basiq account into our normalized `ProviderAccount` shape.
 * `attributes.name` (Basiq's own nickname, which can embed a masked
 * account number) and `attributes.accountNo` are read here only because
 * the `ProviderAccount` interface — matching what a real provider
 * response contains — declares them; the ingestion pipeline
 * (packages/ledger/src/accountAlias.ts,
 * packages/ledger/src/ingestion.ts's toIngestibleAccountFields) never
 * reads `displayName` when computing what's persisted, and
 * `accountNo` is not part of `ProviderAccount` at all (never read past
 * this function existing to prove it isn't).
 */
function mapBasiqAccount(account: BasiqAccount): ProviderAccount {
  return {
    providerAccountId: account.id,
    displayName: account.attributes.name ?? "Account",
    accountType: mapAccountType(account.attributes.class?.type),
    currency: account.attributes.currency ?? "AUD",
    currentBalance: toMoney(account.attributes.balance ?? "0"),
    availableBalance: toMoney(account.attributes.availableFunds ?? account.attributes.balance ?? "0"),
  };
}

/**
 * Basiq's real account class values are not fully confirmed from this
 * environment (see docs/basiq-integration.md); some Basiq accounts are
 * documented as reporting a combined "trans_and_savings"-style class that
 * this simple keyword match can't cleanly split into TRANSACTION vs
 * SAVINGS. That ambiguity doesn't affect correctness: accountType's only
 * currently-exercised dependency is the credit-card-repayment-vs-transfer
 * distinction in packages/ledger/src/transferDetection.ts, which only
 * checks for CREDIT_CARD — TRANSACTION and SAVINGS are treated identically
 * everywhere else (Task 6C's data-minimisation review).
 */
function mapAccountType(basiqType: string | undefined): AccountType {
  const normalized = (basiqType ?? "").toLowerCase();
  if (normalized.includes("credit")) return "CREDIT_CARD";
  if (normalized.includes("trans")) return "TRANSACTION";
  if (normalized.includes("saving")) return "SAVINGS";
  return "OTHER";
}

function mapBasiqTransaction(transaction: BasiqTransaction): ProviderTransaction {
  const { direction, amount } = splitSignedAmount(transaction.attributes.amount);
  const status: TransactionStatus = transaction.attributes.status === "posted" ? "POSTED" : "PENDING";

  return {
    providerTransactionId: transaction.id,
    accountProviderId: transaction.attributes.account,
    transactionDate: transaction.attributes.transactionDate,
    postingDate: status === "POSTED" ? (transaction.attributes.postDate ?? transaction.attributes.transactionDate) : null,
    amount,
    direction,
    status,
    description: transaction.attributes.description,
    reversalOfProviderTransactionId: transaction.attributes.linkedTransactionId ?? null,
  };
}

function splitSignedAmount(raw: string): { direction: TransactionDirection; amount: ReturnType<typeof toMoney> } {
  const isNegative = raw.trim().startsWith("-");
  const magnitude = isNegative ? raw.trim().slice(1) : raw.trim();
  return { direction: isNegative ? "DEBIT" : "CREDIT", amount: toMoney(magnitude) };
}
