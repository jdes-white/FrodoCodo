import type { BasiqListResponse, BasiqTokenResponse } from "./types.js";
import { BASIQ_TOKEN_SCOPES } from "./scopes.js";

const BASIQ_API_BASE_URL = "https://au-api.basiq.io";

/** Matches the global `fetch` signature closely enough to inject a mock in tests. */
export type FetchLike = (input: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

/**
 * Server-level Basiq access token (scope=SERVER_ACCESS, see scopes.ts),
 * obtained by exchanging the Basiq application's API key. Basiq documents
 * this as short-lived (exact lifetime to be confirmed against live docs —
 * see docs/basiq-integration.md); cached in-memory only, per process,
 * refreshed automatically when expired. Deliberately NEVER persisted to
 * the database: unlike a per-household provider token
 * (packages/db/src/connectionTokenStorage.ts), this token is
 * application-wide, cheap to re-derive from BASIQ_API_KEY at any time, and
 * keeping it out of the database entirely is a stronger security property
 * than encrypting it would be (docs/banking-data-minimisation-audit.md's
 * "data never retained cannot later leak" principle applied to this
 * token specifically).
 *
 * Never logged — see docs/basiq-integration.md's logging requirements.
 */
interface CachedServerToken {
  accessToken: string;
  expiresAtMs: number;
}

export class BasiqHttpClient {
  private cachedToken: CachedServerToken | null = null;

  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: FetchLike = globalThis.fetch as unknown as FetchLike,
    private readonly baseUrl: string = BASIQ_API_BASE_URL,
  ) {
    if (!apiKey) {
      throw new Error("BasiqHttpClient requires a non-empty API key (BASIQ_API_KEY) — refusing to start unauthenticated.");
    }
  }

  /** Returns a valid SERVER_ACCESS token, refreshing it if expired or not yet fetched. Never logs the token value. */
  private async getServerToken(): Promise<string> {
    const now = Date.now();
    if (this.cachedToken && this.cachedToken.expiresAtMs > now + 5_000) {
      return this.cachedToken.accessToken;
    }

    const res = await this.fetchImpl(`${this.baseUrl}/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${this.apiKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "basiq-version": "3.0",
      },
      body: `scope=${BASIQ_TOKEN_SCOPES.SERVER}`,
    });

    if (!res.ok) {
      // Never include the API key or response body (may echo request
      // details) in a thrown message that could end up in a log.
      throw new Error(`Basiq token request failed with status ${res.status}.`);
    }

    const token = (await res.json()) as BasiqTokenResponse;
    this.cachedToken = { accessToken: token.access_token, expiresAtMs: now + token.expires_in * 1000 };
    return this.cachedToken.accessToken;
  }

  /**
   * Obtains a restricted, user-bound CLIENT_ACCESS token for `basiqUserId`
   * — used ONLY to build a hosted Consent UI URL (`consentUi.ts`), never
   * for any management API call. Deliberately NOT cached or reused across
   * calls the way the SERVER token is: a CLIENT_ACCESS token is scoped to
   * one specific user and is only ever needed transiently, immediately
   * before constructing a Consent UI redirect, so persisting or reusing it
   * would only create a stale-secret liability with no benefit. Never
   * logged; never include this token's value in a thrown error message.
   */
  async getClientAccessToken(basiqUserId: string): Promise<{ token: string; expiresAtMs: number }> {
    if (!basiqUserId) {
      throw new Error("getClientAccessToken requires a non-empty basiqUserId.");
    }

    const now = Date.now();
    const res = await this.fetchImpl(`${this.baseUrl}/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${this.apiKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "basiq-version": "3.0",
      },
      body: `scope=${BASIQ_TOKEN_SCOPES.CLIENT}&userId=${encodeURIComponent(basiqUserId)}`,
    });

    if (!res.ok) {
      throw new Error(`Basiq client token request failed with status ${res.status}.`);
    }

    const token = (await res.json()) as BasiqTokenResponse;
    return { token: token.access_token, expiresAtMs: now + token.expires_in * 1000 };
  }

  /** GETs a single Basiq resource, authenticated with the cached server token. */
  async get<T>(path: string): Promise<T> {
    const token = await this.getServerToken();
    const res = await this.fetchImpl(`${path.startsWith("http") ? path : `${this.baseUrl}${path}`}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}`, "basiq-version": "3.0" },
    });
    if (!res.ok) {
      throw new Error(`Basiq request to ${redactPath(path)} failed with status ${res.status}.`);
    }
    return (await res.json()) as T;
  }

  /** POSTs to a Basiq resource (user/connection creation) — never called against a real user/institution in this codebase (Task 7A hard stop). */
  async post<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const token = await this.getServerToken();
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "basiq-version": "3.0" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`Basiq request to ${redactPath(path)} failed with status ${res.status}.`);
    }
    return (await res.json()) as T;
  }

  /** DELETEs a Basiq resource (used only for connection revocation/disconnect). */
  async delete(path: string): Promise<void> {
    const token = await this.getServerToken();
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}`, "basiq-version": "3.0" },
    });
    if (!res.ok) {
      throw new Error(`Basiq request to ${redactPath(path)} failed with status ${res.status}.`);
    }
  }

  /**
   * GETs every page of a Basiq list resource, following `links.next` until
   * exhausted. Basiq's list endpoints are JSON:API-style paginated — this
   * is the one place that pagination mechanic lives, so callers
   * (discoverAccounts, syncTransactions) never need to know about it.
   */
  async getAllPages<T>(path: string): Promise<T[]> {
    const results: T[] = [];
    let next: string | undefined = path;
    let guard = 0;
    while (next) {
      if (++guard > 1000) {
        throw new Error("Basiq pagination exceeded 1000 pages — refusing to loop forever.");
      }
      const page: BasiqListResponse<T> = await this.get<BasiqListResponse<T>>(next);
      results.push(...page.data);
      next = page.links?.next;
    }
    return results;
  }
}

/** Strips query params (which may carry filter values, e.g. account IDs) before a path ever reaches a log line or error message. */
function redactPath(path: string): string {
  return path.split("?")[0]!;
}
