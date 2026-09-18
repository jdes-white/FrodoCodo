import { describe, expect, it, vi } from "vitest";
import { BasiqHttpClient, type FetchLike } from "../httpClient.js";

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

describe("BasiqHttpClient (Task 7A) — never contacts the real Basiq API in tests", () => {
  it("requires a non-empty API key", () => {
    expect(() => new BasiqHttpClient("", vi.fn() as unknown as FetchLike)).toThrow(/API key/);
  });

  it("exchanges the API key for a SERVER_ACCESS token and authenticates GETs with it", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: "mock-server-token", token_type: "Bearer", expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: "inst-1" }] }));

    const client = new BasiqHttpClient("mock-api-key-not-real", fetchMock as unknown as FetchLike);
    const result = await client.get<{ data: unknown[] }>("/institutions");

    expect(result.data).toEqual([{ id: "inst-1" }]);
    const tokenCall = fetchMock.mock.calls[0]!;
    expect(tokenCall[1].headers.Authorization).toContain("mock-api-key-not-real");
    expect(tokenCall[1].body).toContain("SERVER_ACCESS");
    const getCall = fetchMock.mock.calls[1]!;
    expect(getCall[1].headers.Authorization).toBe("Bearer mock-server-token");
  });

  it("caches the server token across calls instead of re-authenticating every time", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: "mock-server-token", token_type: "Bearer", expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse({ data: [] }))
      .mockResolvedValueOnce(jsonResponse({ data: [] }));

    const client = new BasiqHttpClient("mock-api-key-not-real", fetchMock as unknown as FetchLike);
    await client.get("/a");
    await client.get("/b");

    // Only one /token exchange for two GETs.
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0]![0]).toContain("/token");
  });

  it("re-authenticates once the cached token has expired", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: "token-1", token_type: "Bearer", expires_in: 0 }))
      .mockResolvedValueOnce(jsonResponse({ data: [] }))
      .mockResolvedValueOnce(jsonResponse({ access_token: "token-2", token_type: "Bearer", expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse({ data: [] }));

    const client = new BasiqHttpClient("mock-api-key-not-real", fetchMock as unknown as FetchLike);
    await client.get("/a");
    await client.get("/b");

    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("follows links.next until exhausted when paginating", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: "tok", token_type: "Bearer", expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse({ data: ["a", "b"], links: { next: "https://au-api.basiq.io/transactions?page=2" } }))
      .mockResolvedValueOnce(jsonResponse({ data: ["c"], links: { next: "https://au-api.basiq.io/transactions?page=3" } }))
      .mockResolvedValueOnce(jsonResponse({ data: ["d"] }));

    const client = new BasiqHttpClient("mock-api-key-not-real", fetchMock as unknown as FetchLike);
    const all = await client.getAllPages<string>("/transactions");

    expect(all).toEqual(["a", "b", "c", "d"]);
  });

  it("returns an empty array immediately when the first page has no data", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: "tok", token_type: "Bearer", expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse({ data: [] }));

    const client = new BasiqHttpClient("mock-api-key-not-real", fetchMock as unknown as FetchLike);
    expect(await client.getAllPages("/transactions")).toEqual([]);
  });

  it("getClientAccessToken requests a CLIENT_ACCESS token bound to the given user, separate from the SERVER token flow", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ access_token: "client-token-abc", token_type: "Bearer", expires_in: 900 }));

    const client = new BasiqHttpClient("mock-api-key-not-real", fetchMock as unknown as FetchLike);
    const result = await client.getClientAccessToken("basiq-user-1");

    expect(result.token).toBe("client-token-abc");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0]!;
    expect(call[1].body).toContain("CLIENT_ACCESS");
    expect(call[1].body).toContain("basiq-user-1");
  });

  it("getClientAccessToken is never cached or reused — a second call always fetches a fresh token", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: "client-token-1", token_type: "Bearer", expires_in: 900 }))
      .mockResolvedValueOnce(jsonResponse({ access_token: "client-token-2", token_type: "Bearer", expires_in: 900 }));

    const client = new BasiqHttpClient("mock-api-key-not-real", fetchMock as unknown as FetchLike);
    const first = await client.getClientAccessToken("basiq-user-1");
    const second = await client.getClientAccessToken("basiq-user-1");

    expect(first.token).toBe("client-token-1");
    expect(second.token).toBe("client-token-2");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("getClientAccessToken requires a non-empty basiqUserId", async () => {
    const client = new BasiqHttpClient("mock-api-key-not-real", vi.fn() as unknown as FetchLike);
    await expect(client.getClientAccessToken("")).rejects.toThrow(/basiqUserId/);
  });

  it("throws (never silently swallows) a non-ok response, without leaking the API key or full URL/query into the message", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: "tok", token_type: "Bearer", expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse({}, false, 401));

    const client = new BasiqHttpClient("mock-api-key-super-secret", fetchMock as unknown as FetchLike);
    let thrown: unknown;
    try {
      await client.get("/users/user-1/accounts?filter=secret-account-ref");
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(Error);
    const message = (thrown as Error).message;
    expect(message).not.toContain("mock-api-key-super-secret");
    expect(message).not.toContain("secret-account-ref");
    expect(message).toContain("401");
  });
});
