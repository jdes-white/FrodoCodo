import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Directly exercises the actual route handler (not just the extracted
 * isSeedingAllowed() helper) to prove the destructive seed pipeline cannot
 * run when NODE_ENV=production — regardless of whether a correct
 * SEED_TOKEN is supplied (security audit finding C2). Route handlers don't
 * need next/headers' request-scoped cookies()/redirect() the way server
 * actions do, so — unlike most of apps/web — this file can import the
 * route module directly under plain vitest (see vitest.config.ts).
 */

const seedDemoHousehold = vi.fn();
vi.mock("@frodocodo/db", () => ({ seedDemoHousehold: (...args: unknown[]) => seedDemoHousehold(...args) }));

function makeRequest(token: string | null): Request {
  const headers = new Headers();
  if (token !== null) headers.set("x-seed-token", token);
  return new Request("http://localhost/api/admin/seed", { method: "POST", headers });
}

describe("POST /api/admin/seed", () => {
  beforeEach(() => {
    seedDemoHousehold.mockReset();
    seedDemoHousehold.mockResolvedValue({ householdId: "h1", transactionCount: 0, adminEmail: "a@b.c", memberEmail: "b@b.c", password: "x" });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("refuses to run in production even with the correct token, and never calls the seeder", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SEED_TOKEN", "correct-token");
    const { POST } = await import("../../app/api/admin/seed/route");

    const response = await POST(makeRequest("correct-token"));

    expect(response.status).toBe(403);
    expect(seedDemoHousehold).not.toHaveBeenCalled();
  });

  it("refuses to run in production even with no token at all", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SEED_TOKEN", "correct-token");
    const { POST } = await import("../../app/api/admin/seed/route");

    const response = await POST(makeRequest(null));

    expect(response.status).toBe(403);
    expect(seedDemoHousehold).not.toHaveBeenCalled();
  });

  it("still requires the correct token outside production", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("SEED_TOKEN", "correct-token");
    const { POST } = await import("../../app/api/admin/seed/route");

    const wrongToken = await POST(makeRequest("wrong-token"));
    expect(wrongToken.status).toBe(401);
    expect(seedDemoHousehold).not.toHaveBeenCalled();

    const rightToken = await POST(makeRequest("correct-token"));
    expect(rightToken.status).toBe(200);
    expect(seedDemoHousehold).toHaveBeenCalledTimes(1);
  });

  it("refuses outside production when SEED_TOKEN isn't configured on the server", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("SEED_TOKEN", undefined as unknown as string);
    delete process.env.SEED_TOKEN;
    const { POST } = await import("../../app/api/admin/seed/route");

    const response = await POST(makeRequest("anything"));
    expect(response.status).toBe(500);
    expect(seedDemoHousehold).not.toHaveBeenCalled();
  });
});
