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
});
