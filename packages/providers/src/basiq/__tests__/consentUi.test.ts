import { describe, expect, it } from "vitest";
import { buildConsentUiUrl, generateConsentState } from "../consentUi.js";

describe("buildConsentUiUrl (Task 7A.1 item 3 — URL construction only, never launched)", () => {
  it("builds the documented hosted Consent UI URL with the token and state", () => {
    const url = buildConsentUiUrl({ clientToken: "client-token-abc", state: "state-xyz" });
    const parsed = new URL(url);

    expect(parsed.origin + parsed.pathname).toBe("https://consent.basiq.io/home");
    expect(parsed.searchParams.get("token")).toBe("client-token-abc");
    expect(parsed.searchParams.get("state")).toBe("state-xyz");
    expect(parsed.searchParams.has("action")).toBe(false);
  });

  it("includes action=connect when adding a subsequent institution to an existing user", () => {
    const url = buildConsentUiUrl({ clientToken: "client-token-abc", state: "state-xyz", action: "connect" });
    const parsed = new URL(url);
    expect(parsed.searchParams.get("action")).toBe("connect");
  });

  it("includes institutionId when the caller already knows which institution to connect (Task 7A.2)", () => {
    const url = buildConsentUiUrl({ clientToken: "client-token-abc", state: "state-xyz", institutionId: "inst-cba-1" });
    const parsed = new URL(url);
    expect(parsed.searchParams.get("institutionId")).toBe("inst-cba-1");
  });

  it("omits institutionId when not supplied", () => {
    const url = buildConsentUiUrl({ clientToken: "client-token-abc", state: "state-xyz" });
    const parsed = new URL(url);
    expect(parsed.searchParams.has("institutionId")).toBe(false);
  });

  it("requires a non-empty clientToken", () => {
    expect(() => buildConsentUiUrl({ clientToken: "", state: "state-xyz" })).toThrow(/clientToken/);
  });

  it("requires a non-empty state", () => {
    expect(() => buildConsentUiUrl({ clientToken: "client-token-abc", state: "" })).toThrow(/state/);
  });

  it("never throws an error whose message contains the token value", () => {
    try {
      buildConsentUiUrl({ clientToken: "super-secret-token-value", state: "" });
      throw new Error("expected buildConsentUiUrl to throw");
    } catch (err) {
      expect((err as Error).message).not.toContain("super-secret-token-value");
    }
  });
});

describe("generateConsentState (Task 7A.1 item 3 — CSRF/mix-up protection)", () => {
  it("generates a non-empty, URL-safe string", () => {
    const state = generateConsentState();
    expect(state.length).toBeGreaterThan(20);
    expect(state).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("generates a different value on every call", () => {
    const values = new Set(Array.from({ length: 20 }, () => generateConsentState()));
    expect(values.size).toBe(20);
  });
});
