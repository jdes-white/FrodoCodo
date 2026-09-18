import { describe, expect, it } from "vitest";
import { MockProvider } from "../mockProvider.js";

describe("MockProvider", () => {
  it("implements the connect -> discover -> sync -> disconnect lifecycle", async () => {
    const provider = new MockProvider();
    const institutions = await provider.listSupportedInstitutions();
    expect(institutions.map((i) => i.providerInstitutionId)).toEqual(["cba", "virgin-money-au", "amex-au"]);

    const { providerConnectionId } = await provider.initiateConnection("cba");
    const consent = await provider.getConsentStatus(providerConnectionId);
    expect(consent.status).toBe("ACTIVE");

    const accounts = await provider.discoverAccounts(providerConnectionId);
    expect(accounts).toHaveLength(1);
    expect(accounts[0]!.accountType).toBe("TRANSACTION");

    const syncResult = await provider.syncTransactions(providerConnectionId, {});
    expect(syncResult.transactions.length).toBeGreaterThan(0);
    expect(syncResult.transactions.every((t) => accounts.some((a) => a.providerAccountId === t.accountProviderId))).toBe(
      true,
    );

    await provider.disconnectConnection(providerConnectionId);
    await expect(provider.getConsentStatus(providerConnectionId)).rejects.toThrow();
  });

  it("scopes each connection's accounts to its own institution", async () => {
    const provider = new MockProvider();
    const cba = await provider.initiateConnection("cba");
    const virgin = await provider.initiateConnection("virgin-money-au");

    const cbaAccounts = await provider.discoverAccounts(cba.providerConnectionId);
    const virginAccounts = await provider.discoverAccounts(virgin.providerConnectionId);

    expect(cbaAccounts.map((a) => a.accountType)).toEqual(["TRANSACTION"]);
    expect(virginAccounts.map((a) => a.accountType)).toEqual(["CREDIT_CARD"]);
  });

  it("supports incremental sync via sinceDate", async () => {
    const provider = new MockProvider();
    const { providerConnectionId } = await provider.initiateConnection("virgin-money-au");
    const full = await provider.syncTransactions(providerConnectionId, {});
    const recent = await provider.syncTransactions(providerConnectionId, { sinceDate: "2026-08-01" });
    expect(recent.transactions.length).toBeLessThanOrEqual(full.transactions.length);
    expect(recent.transactions.every((t) => t.transactionDate >= "2026-08-01")).toBe(true);
  });

  it("reconstructs a connection created by a different process/instance from its persisted ID", async () => {
    // Mirrors reality: the seed script and the background worker are separate
    // Node processes, each with their own MockProvider instance, but both
    // must be able to act on a providerConnectionId persisted to the DB by
    // the other. A real aggregator's backend remembers the connection
    // regardless of which of our processes calls it — this asserts the mock
    // behaves the same way instead of throwing "unknown connection".
    const seedProcessProvider = new MockProvider();
    const { providerConnectionId } = await seedProcessProvider.initiateConnection("amex-au");

    const workerProcessProvider = new MockProvider();
    const accounts = await workerProcessProvider.discoverAccounts(providerConnectionId);
    expect(accounts.map((a) => a.accountType)).toEqual(["CREDIT_CARD"]);

    const sync = await workerProcessProvider.syncTransactions(providerConnectionId, {});
    expect(sync.transactions.length).toBeGreaterThan(0);
  });

  it("rejects an unrecognizable connection ID", async () => {
    const provider = new MockProvider();
    await expect(provider.getConsentStatus("not-a-real-id")).rejects.toThrow();
  });

  it("keeps a disconnected connection revoked even after reconstruction would otherwise succeed", async () => {
    const provider = new MockProvider();
    const { providerConnectionId } = await provider.initiateConnection("cba");
    await provider.disconnectConnection(providerConnectionId);
    await expect(provider.discoverAccounts(providerConnectionId)).rejects.toThrow();
  });
});
