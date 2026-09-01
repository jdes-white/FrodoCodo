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
 * card operations, and never will — see
 * packages/providers/src/basiq/__tests__/basiqProvider.readOnly.test.ts,
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
   * Creates a Basiq user + connection and returns an encoded
   * providerConnectionId (`basiq::<basiqUserId>::<basiqConnectionId>`),
   * mirroring MockProvider's own encoding convention so every later call
   * (getConsentStatus/discoverAccounts/syncTransactions/disconnectConnection)
   * can recover both IDs from the one string this interface passes around.
   *
   * KNOWN PRE-LIVE GAP (see docs/basiq-integration.md): this always
   * creates a fresh Basiq user. A household connecting a SECOND
   * institution (e.g. Virgin after CBA) should reuse the first
   * connection's Basiq user rather than create a second one — this
   * interface method has no household context to look that up itself
   * (packages/providers must never import @frodocodo/db — see CLAUDE.md).
   * A real connection-initiation flow must resolve and pass an existing
   * user reference before this is used for a household's second
   * institution; not built here.
   *
   * `redirectUrl` is intentionally omitted: the exact hosted Consent-UI
   * URL Basiq expects a browser to be sent to could not be confirmed
   * against live documentation from this environment — see
   * docs/basiq-integration.md's unresolved items. Never guess a URL a
   * real household would be redirected to.
   */
  async initiateConnection(institutionId: string): Promise<InitiateConnectionResult> {
    const user = await this.http.post<{ id: string }>("/users", {});
    const connection = await this.http.post<{ id: string }>(`/users/${user.id}/connections`, {
      institution: { id: institutionId },
    });
    return { providerConnectionId: encodeProviderConnectionId(user.id, connection.id) };
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
    return accounts.map(mapBasiqAccount);
  }

  async syncTransactions(
    providerConnectionId: string,
    options: { sinceDate?: string; accountProviderIds?: string[] },
  ): Promise<ProviderSyncResult> {
    const { basiqUserId } = decodeProviderConnectionId(providerConnectionId);

    // Best-effort server-side filter (exact Basiq filter query syntax
    // unverified — see docs/basiq-integration.md). The in-memory filter
    // below guarantees the contract regardless of whether this filter
    // string is honoured server-side.
    const filters: string[] = [];
    if (options.sinceDate) filters.push(`transaction.postDate.gte:${options.sinceDate}`);
    const query = filters.length > 0 ? `?filter=${encodeURIComponent(filters.join(","))}` : "";

    const rawTransactions = await this.http.getAllPages<BasiqTransaction>(`/users/${basiqUserId}/transactions${query}`);

    const accountFilter = options.accountProviderIds ? new Set(options.accountProviderIds) : null;
    const transactions = rawTransactions
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
