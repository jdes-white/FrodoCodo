import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { beginBasiqConsent } from "../factory.js";

function jsonResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}

describe("beginBasiqConsent (Task 7C — the one place a caller obtains a Consent UI redirect)", () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.BASIQ_API_KEY;

  beforeEach(() => {
    process.env.BASIQ_API_KEY = "mock-api-key-not-real";
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.BASIQ_API_KEY;
    else process.env.BASIQ_API_KEY = originalApiKey;
  });

  it("requires BASIQ_API_KEY", async () => {
    delete process.env.BASIQ_API_KEY;
    await expect(beginBasiqConsent("basiq-user-1")).rejects.toThrow(/BASIQ_API_KEY/);
  });

  it("obtains a CLIENT_ACCESS token bound to the given user and builds a Consent UI URL with a fresh state", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ access_token: "client-token-xyz", token_type: "Bearer", expires_in: 900 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await beginBasiqConsent("basiq-user-1", { institutionId: "inst-cba-1", action: "connect" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0]!;
    expect((call[1] as { body: string }).body).toContain("CLIENT_ACCESS");
    expect((call[1] as { body: string }).body).toContain("basiq-user-1");

    const url = new URL(result.url);
    expect(url.origin + url.pathname).toBe("https://consent.basiq.io/home");
    expect(url.searchParams.get("token")).toBe("client-token-xyz");
    expect(url.searchParams.get("action")).toBe("connect");
    expect(url.searchParams.get("institutionId")).toBe("inst-cba-1");
    expect(url.searchParams.get("state")).toBe(result.state);
    expect(result.state.length).toBeGreaterThan(20);
  });

  it("omits action/institutionId from the URL when not supplied", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ access_token: "client-token-abc", token_type: "Bearer", expires_in: 900 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await beginBasiqConsent("basiq-user-2");
    const url = new URL(result.url);
    expect(url.searchParams.has("action")).toBe(false);
    expect(url.searchParams.has("institutionId")).toBe(false);
  });

  it("never throws an error containing the client token or API key", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}) });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    let thrown: unknown;
    try {
      await beginBasiqConsent("basiq-user-3");
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).not.toContain("mock-api-key-not-real");
  });
});
