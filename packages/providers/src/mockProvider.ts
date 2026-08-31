import { todayUTC } from "@frodocodo/shared";
import { generateHouseholdDataset, MOCK_ACCOUNT_IDS } from "./mockDataset.js";
import type {
  ConsentInfo,
  FinancialDataProvider,
  InitiateConnectionResult,
  ProviderAccount,
  ProviderInstitution,
  ProviderSyncResult,
  ProviderTransaction,
} from "./types.js";

export const MOCK_INSTITUTIONS: ProviderInstitution[] = [
  { providerInstitutionId: "cba", name: "Commonwealth Bank of Australia", shortName: "CBA", connectionMethod: "CDR" },
  { providerInstitutionId: "virgin-money-au", name: "Virgin Money Australia", shortName: "Virgin", connectionMethod: "CDR" },
  { providerInstitutionId: "amex-au", name: "American Express Australia", shortName: "Amex", connectionMethod: "CREDENTIAL_BASED" },
];

interface MockConnectionState {
  institutionId: string;
  consent: ConsentInfo;
  dataset: { accounts: ProviderAccount[]; transactions: ProviderTransaction[] } | null;
}

const ID_PREFIX = "mock";
const ID_SEPARATOR = "::";

/**
 * Generates realistic CBA/Virgin Money/Amex-shaped synthetic data so the
 * whole product can be built, tested and demoed with zero live credentials
 * (§55). Implements the exact same FinancialDataProvider interface a real
 * aggregator adapter (e.g. Basiq) would — swapping providers is a config
 * change, not a rewrite (§7).
 *
 * A real aggregator's backend remembers a connection regardless of which of
 * our server processes calls it (the seed script, a web request, the
 * worker — different Node processes, same persisted providerConnectionId).
 * This class has no shared backend, so the institutionId is encoded into
 * the connection ID itself and state is lazily reconstructed from it on
 * first use in a given process — the one exception being an explicitly
 * disconnected connection, which stays revoked for this process's lifetime.
 */
export class MockProvider implements FinancialDataProvider {
  readonly id = "mock";
  private connections = new Map<string, MockConnectionState>();
  private disconnected = new Set<string>();
  private connectionCounter = 1;

  async listSupportedInstitutions(): Promise<ProviderInstitution[]> {
    return MOCK_INSTITUTIONS;
  }

  async initiateConnection(institutionId: string): Promise<InitiateConnectionResult> {
    const providerConnectionId = `${ID_PREFIX}${ID_SEPARATOR}${institutionId}${ID_SEPARATOR}${this.connectionCounter++}`;
    this.connections.set(providerConnectionId, this.freshState(institutionId));
    return { providerConnectionId };
  }

  async getConsentStatus(providerConnectionId: string): Promise<ConsentInfo> {
    return this.requireConnection(providerConnectionId).consent;
  }

  async discoverAccounts(providerConnectionId: string): Promise<ProviderAccount[]> {
    const state = this.requireConnection(providerConnectionId);
    const dataset = this.ensureDataset(state);
    return dataset.accounts.filter((a) => this.accountBelongsToInstitution(a.providerAccountId, state.institutionId));
  }

  async syncTransactions(
    providerConnectionId: string,
    options: { sinceDate?: string; accountProviderIds?: string[] },
  ): Promise<ProviderSyncResult> {
    const state = this.requireConnection(providerConnectionId);
    const dataset = this.ensureDataset(state);

    const relevantAccountIds = new Set(
      dataset.accounts
        .filter((a) => this.accountBelongsToInstitution(a.providerAccountId, state.institutionId))
        .map((a) => a.providerAccountId),
    );

    let transactions = dataset.transactions.filter((t) => relevantAccountIds.has(t.accountProviderId));
    if (options.accountProviderIds?.length) {
      const requested = new Set(options.accountProviderIds);
      transactions = transactions.filter((t) => requested.has(t.accountProviderId));
    }
    if (options.sinceDate) {
      transactions = transactions.filter((t) => t.transactionDate >= options.sinceDate!);
    }

    return {
      accounts: dataset.accounts.filter((a) => relevantAccountIds.has(a.providerAccountId)),
      transactions,
      syncedAt: new Date().toISOString(),
      errors: [],
    };
  }

  async disconnectConnection(providerConnectionId: string): Promise<void> {
    this.connections.delete(providerConnectionId);
    this.disconnected.add(providerConnectionId);
  }

  private ensureDataset(state: MockConnectionState) {
    if (!state.dataset) {
      state.dataset = generateHouseholdDataset({ asOfDate: todayUTC(), monthsOfHistory: 4, seed: 7 });
    }
    return state.dataset;
  }

  private freshState(institutionId: string): MockConnectionState {
    return {
      institutionId,
      consent: { status: "ACTIVE", grantedAt: new Date().toISOString(), expiresAt: oneYearFromNow() },
      dataset: null,
    };
  }

  private requireConnection(providerConnectionId: string): MockConnectionState {
    const existing = this.connections.get(providerConnectionId);
    if (existing) return existing;

    if (this.disconnected.has(providerConnectionId)) {
      throw new Error(`Connection ${providerConnectionId} has been disconnected`);
    }

    const institutionId = this.parseInstitutionId(providerConnectionId);
    if (!institutionId) throw new Error(`Unknown mock connection: ${providerConnectionId}`);

    const state = this.freshState(institutionId);
    this.connections.set(providerConnectionId, state);
    return state;
  }

  private parseInstitutionId(providerConnectionId: string): string | null {
    const parts = providerConnectionId.split(ID_SEPARATOR);
    if (parts.length !== 3 || parts[0] !== ID_PREFIX) return null;
    const institutionId = parts[1]!;
    return MOCK_INSTITUTIONS.some((inst) => inst.providerInstitutionId === institutionId) ? institutionId : null;
  }

  private accountBelongsToInstitution(accountProviderId: string, institutionId: string): boolean {
    if (institutionId === "cba") return accountProviderId === MOCK_ACCOUNT_IDS.cbaTransaction;
    if (institutionId === "virgin-money-au") return accountProviderId === MOCK_ACCOUNT_IDS.virginCreditCard;
    if (institutionId === "amex-au") return accountProviderId === MOCK_ACCOUNT_IDS.amexCreditCard;
    return false;
  }
}

function oneYearFromNow(): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() + 1);
  return d.toISOString();
}
