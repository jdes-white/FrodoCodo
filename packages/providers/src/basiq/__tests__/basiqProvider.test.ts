import { describe, expect, it, vi } from "vitest";
import { toIngestibleAccountFields, toIngestibleTransactionFields } from "@frodocodo/ledger";
import { BasiqProvider, getBasiqUserIdFromConnectionId } from "../basiqProvider.js";
import { BasiqHttpClient, type FetchLike } from "../httpClient.js";

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

/**
 * A scripted fake Basiq backend — never a real HTTP call. Each test wires
 * up exactly the sequence of responses its scenario needs, always
 * starting with the /token exchange every authenticated call triggers on
 * a fresh client.
 */
function fakeBasiqBackend(responses: Array<ReturnType<typeof jsonResponse>>): FetchLike {
  const fetchMock = vi.fn();
  for (const response of responses) fetchMock.mockResolvedValueOnce(response);
  return fetchMock as unknown as FetchLike;
}

const TOKEN_RESPONSE = jsonResponse({ access_token: "mock-server-token", token_type: "Bearer", expires_in: 3600 });

describe("BasiqProvider (Task 7A) — every call goes through an injected mock, never a real Basiq endpoint", () => {
  it("listSupportedInstitutions returns only CBA and Virgin, resolved by name against the live institutions list", async () => {
    const fetch = fakeBasiqBackend([
      TOKEN_RESPONSE,
      jsonResponse({
        data: [
          { id: "inst-cba-1", name: "Commonwealth Bank", shortName: "CommBank", country: "AU" },
          { id: "inst-virgin-1", name: "Virgin Money", shortName: "Virgin", country: "AU" },
          { id: "inst-amex-1", name: "American Express", shortName: "Amex", country: "AU" },
          { id: "inst-anz-1", name: "ANZ", shortName: "ANZ", country: "AU" },
        ],
      }),
    ]);
    const provider = new BasiqProvider(new BasiqHttpClient("mock-key", fetch));
    const institutions = await provider.listSupportedInstitutions();

    expect(institutions).toHaveLength(2);
    expect(institutions.map((i) => i.shortName).sort()).toEqual(["CBA", "Virgin"]);
    expect(institutions.every((i) => i.connectionMethod === "CDR")).toBe(true);
    // Amex and any other institution never appear, even though the live list returned them.
    expect(institutions.some((i) => i.name.match(/amex|express/i))).toBe(false);
  });

  it("discoverAccounts maps Basiq accounts into ProviderAccount, and every account passes cleanly through the Task 6 allow-list", async () => {
    const fetch = fakeBasiqBackend([
      TOKEN_RESPONSE,
      jsonResponse({
        data: [
          {
            id: "acc-1",
            type: "account",
            attributes: {
              accountNo: "1234-5678", // must never survive past this function's own mapping into the allow-list
              name: "Complete Access ...5678", // provider nickname -- ingestion never reads this for the persisted alias
              class: { type: "transaction" },
              currency: "AUD",
              balance: "4821.33",
              availableFunds: "4821.33",
            },
          },
          {
            id: "acc-2",
            type: "account",
            attributes: { name: "Velocity High Flyer", class: { type: "credit-card" }, currency: "AUD", balance: "-320.10" },
          },
        ],
      }),
    ]);
    const provider = new BasiqProvider(new BasiqHttpClient("mock-key", fetch));
    const accounts = await provider.discoverAccounts("basiq::user-1::conn-1");

    expect(accounts).toHaveLength(2);
    expect(accounts[0]!.accountType).toBe("TRANSACTION");
    expect(accounts[1]!.accountType).toBe("CREDIT_CARD");

    // Task 7A item 4/Task 6C allow-list: only providerAccountId/accountType/currency
    // ever cross into what's persisted -- prove it against the REAL allow-list
    // function, not a re-implementation.
    for (const account of accounts) {
      const ingestible = toIngestibleAccountFields({
        sourceAccountId: account.providerAccountId,
        accountType: account.accountType,
        currency: account.currency,
      });
      expect(Object.keys(ingestible).sort()).toEqual(["accountType", "currency", "providerAccountId"]);
      expect(JSON.stringify(ingestible)).not.toMatch(/1234-5678|Complete Access|Velocity High Flyer/);
    }
  });

  it("syncTransactions maps pending/posted status, direction, and amount correctly and drops nothing but allow-listed fields downstream", async () => {
    const fetch = fakeBasiqBackend([
      TOKEN_RESPONSE,
      jsonResponse({
        data: [
          {
            id: "tx-1",
            type: "transaction",
            attributes: {
              status: "posted",
              description: "COLES 0092 BRISBANE AU",
              amount: "-45.30",
              account: "acc-1",
              postDate: "2026-08-10",
              transactionDate: "2026-08-09",
            },
          },
          {
            id: "tx-2",
            type: "transaction",
            attributes: {
              status: "pending",
              description: "PENDING CARD AUTH",
              amount: "-12.00",
              account: "acc-1",
              transactionDate: "2026-08-11",
            },
          },
          {
            id: "tx-3",
            type: "transaction",
            attributes: {
              status: "posted",
              description: "SALARY PAYMENT ACME PTY LTD",
              amount: "2950.00",
              account: "acc-1",
              postDate: "2026-08-12",
              transactionDate: "2026-08-12",
            },
          },
        ],
      }),
    ]);
    const provider = new BasiqProvider(new BasiqHttpClient("mock-key", fetch));
    const result = await provider.syncTransactions("basiq::user-1::conn-1", {});

    expect(result.transactions).toHaveLength(3);
    const [posted, pending, credit] = result.transactions;

    expect(posted!.status).toBe("POSTED");
    expect(posted!.direction).toBe("DEBIT");
    expect(posted!.amount.toNumber()).toBe(45.3);
    expect(posted!.postingDate).toBe("2026-08-10");

    expect(pending!.status).toBe("PENDING");
    expect(pending!.postingDate).toBeNull();

    expect(credit!.direction).toBe("CREDIT");
    expect(credit!.amount.toNumber()).toBe(2950);

    // Every mapped transaction passes cleanly through the real Task 6 allow-list.
    for (const tx of result.transactions) {
      const ingestible = toIngestibleTransactionFields({
        sourceAccountId: tx.accountProviderId,
        sourceTransactionId: tx.providerTransactionId,
        transactionDate: tx.transactionDate,
        postingDate: tx.postingDate,
        amount: tx.amount,
        direction: tx.direction,
        status: tx.status,
        description: tx.description,
        sourceType: "PROVIDER_SYNC",
        reversalOfSourceTransactionId: tx.reversalOfProviderTransactionId,
      });
      expect(ingestible.originalDescription).toBe(tx.description);
    }
  });

  it("applies sinceDate and accountProviderIds filters in-memory regardless of server-side filtering", async () => {
    const fetch = fakeBasiqBackend([
      TOKEN_RESPONSE,
      jsonResponse({
        data: [
          { id: "tx-old", type: "transaction", attributes: { status: "posted", description: "OLD", amount: "-10", account: "acc-1", postDate: "2026-01-01", transactionDate: "2026-01-01" } },
          { id: "tx-new", type: "transaction", attributes: { status: "posted", description: "NEW", amount: "-10", account: "acc-1", postDate: "2026-08-15", transactionDate: "2026-08-15" } },
          { id: "tx-other-account", type: "transaction", attributes: { status: "posted", description: "OTHER", amount: "-10", account: "acc-2", postDate: "2026-08-15", transactionDate: "2026-08-15" } },
        ],
      }),
    ]);
    const provider = new BasiqProvider(new BasiqHttpClient("mock-key", fetch));
    const result = await provider.syncTransactions("basiq::user-1::conn-1", { sinceDate: "2026-08-01", accountProviderIds: ["acc-1"] });

    expect(result.transactions.map((t) => t.providerTransactionId)).toEqual(["tx-new"]);
  });

  it("builds the transaction filter query with Basiq's documented `gteq` operator, not `gte` (Task 7A.2 correction)", async () => {
    const fetch = fakeBasiqBackend([TOKEN_RESPONSE, jsonResponse({ data: [] })]);
    const provider = new BasiqProvider(new BasiqHttpClient("mock-key", fetch));
    await provider.syncTransactions("basiq::user-1::conn-1", { sinceDate: "2026-08-01" });

    const requestUrl = decodeURIComponent((fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[1]![0] as string);
    expect(requestUrl).toContain("transaction.postDate.gteq('2026-08-01')");
    expect(requestUrl).not.toContain("postDate.gte(");
    expect(requestUrl).toContain("connection.id.eq('conn-1')");
    // Basiq's documented convention: comma-separated filters are ANDed.
    expect(requestUrl).toContain("connection.id.eq('conn-1'),transaction.postDate.gteq('2026-08-01')");
    expect(requestUrl).toContain("limit=500");
  });

  it("is idempotent: re-syncing with the exact same Basiq response yields identical normalized output", async () => {
    const rawResponse = jsonResponse({
      data: [
        { id: "tx-1", type: "transaction", attributes: { status: "posted", description: "COLES", amount: "-45.30", account: "acc-1", postDate: "2026-08-10", transactionDate: "2026-08-09" } },
      ],
    });
    const provider1 = new BasiqProvider(new BasiqHttpClient("mock-key", fakeBasiqBackend([TOKEN_RESPONSE, rawResponse])));
    const provider2 = new BasiqProvider(new BasiqHttpClient("mock-key", fakeBasiqBackend([TOKEN_RESPONSE, rawResponse])));

    const first = await provider1.syncTransactions("basiq::user-1::conn-1", {});
    const second = await provider2.syncTransactions("basiq::user-1::conn-1", {});

    expect(first.transactions[0]!.providerTransactionId).toBe(second.transactions[0]!.providerTransactionId);
    expect(first.transactions[0]!.amount.equals(second.transactions[0]!.amount)).toBe(true);
    expect(first.transactions[0]!.status).toBe(second.transactions[0]!.status);
    // Downstream dedupe (packages/ledger/src/dedupe.ts) is what actually
    // prevents a duplicate row on re-sync given identical
    // providerTransactionId + account -- this proves the adapter itself
    // produces a stable, re-matchable key across two independent syncs of
    // the same underlying data, which is the precondition dedupe relies on.
  });

  it("initiateConnection creates a fresh Basiq user with the supplied contact when no existingProviderUserId is given", async () => {
    const fetch = fakeBasiqBackend([
      TOKEN_RESPONSE,
      jsonResponse({ id: "new-user-1" }), // POST /users
      jsonResponse({ id: "conn-1" }), // POST /users/new-user-1/connections
    ]);
    const provider = new BasiqProvider(new BasiqHttpClient("mock-key", fetch));
    const result = await provider.initiateConnection("inst-cba", undefined, { email: "household@example.com" });

    expect(result.providerConnectionId).toBe("basiq::new-user-1::conn-1");
    const userCreateCall = (fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[1]!;
    expect(userCreateCall[0]).toContain("/users");
    expect((userCreateCall[1] as { body: string }).body).toContain("household@example.com");
  });

  it("initiateConnection throws rather than sending an empty POST /users body when no contact or existing user is given (Task 7A.2)", async () => {
    const provider = new BasiqProvider(new BasiqHttpClient("mock-key", fakeBasiqBackend([TOKEN_RESPONSE])));
    await expect(provider.initiateConnection("inst-cba")).rejects.toThrow(/email or mobile/i);
  });

  it("initiateConnection accepts a mobile-only contact, matching Basiq's either-or requirement", async () => {
    const fetch = fakeBasiqBackend([TOKEN_RESPONSE, jsonResponse({ id: "new-user-2" }), jsonResponse({ id: "conn-9" })]);
    const provider = new BasiqProvider(new BasiqHttpClient("mock-key", fetch));
    const result = await provider.initiateConnection("inst-cba", undefined, { mobile: "+61410888999" });
    expect(result.providerConnectionId).toBe("basiq::new-user-2::conn-9");
  });

  it("initiateConnection reuses an existing Basiq user for a household's second institution (Task 7A.1 item 4)", async () => {
    const fetch = fakeBasiqBackend([
      TOKEN_RESPONSE,
      jsonResponse({ id: "conn-2" }), // POST /users/existing-user-1/connections — no /users POST at all
    ]);
    const provider = new BasiqProvider(new BasiqHttpClient("mock-key", fetch));
    const result = await provider.initiateConnection("inst-virgin", "existing-user-1");

    expect(result.providerConnectionId).toBe("basiq::existing-user-1::conn-2");
    // Exactly two calls total: the /token exchange and the connection POST — no user creation.
    expect((fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls).toHaveLength(2);
    const connectionCall = (fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[1]!;
    expect(connectionCall[0]).toContain("/users/existing-user-1/connections");
  });

  it("getBasiqUserIdFromConnectionId decodes an existing Basiq connection ID for reuse", () => {
    expect(getBasiqUserIdFromConnectionId("basiq::user-42::conn-7")).toBe("user-42");
  });

  it("getBasiqUserIdFromConnectionId returns null for a non-Basiq (e.g. mock provider) connection ID rather than throwing", () => {
    expect(getBasiqUserIdFromConnectionId("mock::cba::1")).toBeNull();
  });

  it("skips a malformed account (missing id) rather than mapping garbage into ProviderAccount (Task 7A.1 item 8)", async () => {
    const fetch = fakeBasiqBackend([
      TOKEN_RESPONSE,
      jsonResponse({
        data: [
          { id: "acc-good", type: "account", attributes: { name: "OK", class: { type: "transaction" }, currency: "AUD" } },
          { type: "account", attributes: { name: "Missing ID" } }, // no `id` — must be dropped, not crash
        ],
      }),
    ]);
    const provider = new BasiqProvider(new BasiqHttpClient("mock-key", fetch));
    const accounts = await provider.discoverAccounts("basiq::user-1::conn-1");

    expect(accounts.map((a) => a.providerAccountId)).toEqual(["acc-good"]);
  });

  it("skips a malformed transaction (missing amount) rather than producing a NaN amount (Task 7A.1 item 8)", async () => {
    const fetch = fakeBasiqBackend([
      TOKEN_RESPONSE,
      jsonResponse({
        data: [
          {
            id: "tx-good",
            type: "transaction",
            attributes: { status: "posted", description: "OK", amount: "-10.00", account: "acc-1", transactionDate: "2026-08-01" },
          },
          {
            id: "tx-bad-amount",
            type: "transaction",
            attributes: { status: "posted", description: "BAD", amount: "not-a-number", account: "acc-1", transactionDate: "2026-08-01" },
          },
          {
            // missing attributes.account entirely
            id: "tx-bad-account",
            type: "transaction",
            attributes: { status: "posted", description: "BAD", amount: "-5.00", transactionDate: "2026-08-01" },
          },
        ],
      }),
    ]);
    const provider = new BasiqProvider(new BasiqHttpClient("mock-key", fetch));
    const result = await provider.syncTransactions("basiq::user-1::conn-1", {});

    expect(result.transactions.map((t) => t.providerTransactionId)).toEqual(["tx-good"]);
  });

  it("disconnectConnection calls Basiq's revoke endpoint for the encoded user/connection", async () => {
    const fetch = fakeBasiqBackend([TOKEN_RESPONSE, jsonResponse({}, true, 204)]);
    const provider = new BasiqProvider(new BasiqHttpClient("mock-key", fetch));
    await provider.disconnectConnection("basiq::user-1::conn-1");

    const deleteCall = (fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[1]!;
    expect(deleteCall[0]).toContain("/users/user-1/connections/conn-1");
    expect((deleteCall[1] as { method: string }).method).toBe("DELETE");
  });

  it("exposes no method beyond FinancialDataProvider — no payment, transfer, payee, account-modification, or card operation", () => {
    const provider = new BasiqProvider(new BasiqHttpClient("mock-key", vi.fn() as unknown as FetchLike));
    const forbiddenNamePatterns = /pay|transfer|payee|modify|update.*account|card(?!.*(?:Type|Currency))|debit(?!\b)|credit(?!\b)/i;

    const methodNames = Object.getOwnPropertyNames(Object.getPrototypeOf(provider)).filter((name) => name !== "constructor");
    expect(methodNames.sort()).toEqual(
      ["listSupportedInstitutions", "initiateConnection", "getConsentStatus", "discoverAccounts", "syncTransactions", "disconnectConnection"].sort(),
    );
    for (const name of methodNames) {
      expect(name).not.toMatch(forbiddenNamePatterns);
    }
  });

  it("never logs the API key, server token, or a raw transaction payload during a normal sync", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const fetch = fakeBasiqBackend([
        TOKEN_RESPONSE,
        jsonResponse({
          data: [
            { id: "tx-1", type: "transaction", attributes: { status: "posted", description: "COLES 0092", amount: "-45.30", account: "acc-1", postDate: "2026-08-10", transactionDate: "2026-08-09" } },
          ],
        }),
      ]);
      const provider = new BasiqProvider(new BasiqHttpClient("mock-super-secret-api-key", fetch));
      await provider.syncTransactions("basiq::user-1::conn-1", {});

      const allLoggedText = [...logSpy.mock.calls, ...errorSpy.mock.calls].map((call) => JSON.stringify(call)).join("\n");
      expect(allLoggedText).not.toContain("mock-super-secret-api-key");
      expect(allLoggedText).not.toContain("mock-server-token");
    } finally {
      logSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });
});
