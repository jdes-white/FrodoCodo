import { describe, expect, it } from "vitest";
import {
  BASIQ_TOKEN_SCOPES,
  BASIQ_SERVER_TOKEN_SCOPE,
  BASIQ_CONSENT_POLICY_SCOPES,
  BASIQ_REFUSED_CONSENT_POLICY_SCOPES,
  SUPPORTED_INSTITUTIONS,
} from "../scopes.js";

describe("Basiq API token scopes (Task 7A.1 item 1/2 — distinct from CDR consent scopes)", () => {
  it("uses SERVER_ACCESS for every server-to-server management call", () => {
    expect(BASIQ_TOKEN_SCOPES.SERVER).toBe("SERVER_ACCESS");
    expect(BASIQ_SERVER_TOKEN_SCOPE).toBe("SERVER_ACCESS");
  });

  it("uses CLIENT_ACCESS only for the restricted, user-bound Consent UI token type", () => {
    expect(BASIQ_TOKEN_SCOPES.CLIENT).toBe("CLIENT_ACCESS");
  });

  it("keeps the two token scopes distinct", () => {
    expect(BASIQ_TOKEN_SCOPES.SERVER).not.toBe(BASIQ_TOKEN_SCOPES.CLIENT);
  });
});

describe("Basiq CDR consent-policy scopes (Task 7A.1 item 1 — dashboard configuration, never sent as a token scope)", () => {
  it("requires exactly basic account discovery + transactions, nothing broader", () => {
    expect([...BASIQ_CONSENT_POLICY_SCOPES].sort()).toEqual(["bank:accounts.basic:read", "bank:transactions:read"]);
  });

  it("does not overlap with any refused consent-policy scope", () => {
    const requested = new Set<string>(BASIQ_CONSENT_POLICY_SCOPES);
    for (const refused of BASIQ_REFUSED_CONSENT_POLICY_SCOPES) {
      expect(requested.has(refused)).toBe(false);
    }
  });

  it("enumerates every consent-policy scope the task explicitly said to refuse", () => {
    const refused = new Set<string>(BASIQ_REFUSED_CONSENT_POLICY_SCOPES);
    expect(refused.has("bank:accounts.detail:read")).toBe(true); // unmasked account number/BSB/detailed product terms
    expect(refused.has("common:customer.basic:read")).toBe(true); // customer name
    expect(refused.has("common:customer.detail:read")).toBe(true); // address/contact/DOB
    expect(refused.has("bank:payees:read")).toBe(true); // payee lists
    expect(refused.has("bank:regular_payments:read")).toBe(true); // scheduled-payment / direct-debit metadata
  });

  it("uses real CDR-namespaced scope strings, not Task 7A's placeholder cluster names", () => {
    for (const scope of BASIQ_CONSENT_POLICY_SCOPES) {
      expect(scope).toMatch(/^[a-z]+:[a-z.]+:read$/);
    }
  });
});

describe("Supported institution allow-list (Task 7A.1 item 5)", () => {
  it("lists CBA and Virgin with a short, explicit approved-name allow-list each", () => {
    expect(SUPPORTED_INSTITUTIONS.CBA.approvedNames.length).toBeGreaterThan(0);
    expect(SUPPORTED_INSTITUTIONS.VIRGIN.approvedNames.length).toBeGreaterThan(0);
  });

  it("never lists Amex or any other institution", () => {
    const allNames = [...SUPPORTED_INSTITUTIONS.CBA.approvedNames, ...SUPPORTED_INSTITUTIONS.VIRGIN.approvedNames];
    expect(allNames.some((n) => /amex|express/i.test(n))).toBe(false);
  });
});
