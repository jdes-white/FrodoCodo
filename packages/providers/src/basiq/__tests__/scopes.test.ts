import { describe, expect, it } from "vitest";
import { BASIQ_REQUESTED_DATA_CLUSTERS, BASIQ_REFUSED_DATA_CLUSTERS, BASIQ_SERVER_TOKEN_SCOPE } from "../scopes.js";

describe("Basiq scope constants (Task 7A consent boundary)", () => {
  it("requests exactly accounts + transactions, nothing broader", () => {
    expect([...BASIQ_REQUESTED_DATA_CLUSTERS].sort()).toEqual(["accounts", "transactions"]);
  });

  it("does not request or depend on any refused data cluster", () => {
    const requested = new Set(BASIQ_REQUESTED_DATA_CLUSTERS);
    for (const refused of BASIQ_REFUSED_DATA_CLUSTERS) {
      expect(requested.has(refused as never)).toBe(false);
    }
  });

  it("enumerates every category the task explicitly said to refuse", () => {
    const refused = new Set(BASIQ_REFUSED_DATA_CLUSTERS);
    expect(refused.has("account_details")).toBe(true); // unmasked account numbers, BSBs
    expect(refused.has("identity")).toBe(true); // customer identity/profile, address/contact/DOB
    expect(refused.has("payees")).toBe(true); // payee lists
    expect(refused.has("regular_payments")).toBe(true); // scheduled-payment data
    expect(refused.has("cards")).toBe(true); // card credentials/details
    expect(refused.has("payments")).toBe(true); // payment initiation / money movement
  });

  it("authenticates server-to-server calls with SERVER_ACCESS, never a narrower or client-facing scope", () => {
    expect(BASIQ_SERVER_TOKEN_SCOPE).toBe("SERVER_ACCESS");
  });
});
