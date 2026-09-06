import { beforeEach, describe, expect, it, vi } from "vitest";

const count = vi.fn();
const create = vi.fn();
const deleteMany = vi.fn();
vi.mock("@frodocodo/db", () => ({ prisma: { loginAttempt: { count: (...a: unknown[]) => count(...a), create: (...a: unknown[]) => create(...a), deleteMany: (...a: unknown[]) => deleteMany(...a) } } }));

const { normalizeLoginIdentifier, isLoginRateLimited, recordLoginAttempt } = await import("../loginRateLimit");

describe("normalizeLoginIdentifier", () => {
  it("trims and lowercases", () => {
    expect(normalizeLoginIdentifier("  Admin@Example.com ")).toBe("admin@example.com");
  });
});

describe("isLoginRateLimited", () => {
  beforeEach(() => {
    count.mockReset();
    deleteMany.mockReset().mockResolvedValue({ count: 0 });
  });

  it("normal login: allows a fresh identifier with no prior failures", async () => {
    count.mockResolvedValue(0);
    expect(await isLoginRateLimited("a@example.com", "1.2.3.4")).toBe(false);
  });

  it("repeated failed attempts: stays allowed below the per-identifier threshold", async () => {
    count.mockImplementation(async ({ where }: { where: { identifier?: string; ipAddress?: string } }) => {
      if (where.identifier) return 4; // one below the threshold of 5
      return 0;
    });
    expect(await isLoginRateLimited("a@example.com", "1.2.3.4")).toBe(false);
  });

  it("successful throttling: blocks once the per-identifier threshold is reached", async () => {
    count.mockImplementation(async ({ where }: { where: { identifier?: string; ipAddress?: string } }) => {
      if (where.identifier) return 5;
      return 0;
    });
    expect(await isLoginRateLimited("a@example.com", "1.2.3.4")).toBe(true);
  });

  it("successful throttling: also blocks once the coarser per-IP threshold is reached, even for a brand-new identifier", async () => {
    count.mockImplementation(async ({ where }: { where: { identifier?: string; ipAddress?: string } }) => {
      if (where.ipAddress) return 20;
      return 0;
    });
    expect(await isLoginRateLimited("never-seen-before@example.com", "9.9.9.9")).toBe(true);
  });

  it("recovery after the throttle window: only counts failures within the rolling window (query is scoped by createdAt)", async () => {
    let capturedSince: Date | undefined;
    count.mockImplementation(async ({ where }: { where: { identifier?: string; createdAt?: { gte: Date } } }) => {
      if (where.identifier) capturedSince = where.createdAt?.gte;
      return 0; // simulates: all prior failures are now older than the window, so the count query returns 0
    });
    const before = Date.now();
    expect(await isLoginRateLimited("a@example.com", "1.2.3.4")).toBe(false);
    expect(capturedSince).toBeInstanceOf(Date);
    expect(capturedSince!.getTime()).toBeLessThan(before);
    expect(capturedSince!.getTime()).toBeGreaterThan(before - 16 * 60 * 1000); // within the 15-minute window, not e.g. epoch
  });

  it("different users not incorrectly locking one another out: each identifier is checked independently", async () => {
    count.mockImplementation(async ({ where }: { where: { identifier?: string; ipAddress?: string } }) => {
      if (where.identifier === "locked-out@example.com") return 5;
      if (where.identifier === "fine@example.com") return 0;
      return 0; // shared IP's own coarse bucket stays under its much higher threshold
    });
    expect(await isLoginRateLimited("locked-out@example.com", "1.2.3.4")).toBe(true);
    expect(await isLoginRateLimited("fine@example.com", "1.2.3.4")).toBe(false);
  });

  it("skips the per-IP check entirely when no IP is available (e.g. local dev with no proxy header)", async () => {
    count.mockImplementation(async ({ where }: { where: { identifier?: string; ipAddress?: string } }) => {
      if (where.identifier) return 0;
      throw new Error("should not query by ipAddress when ip is null");
    });
    expect(await isLoginRateLimited("a@example.com", null)).toBe(false);
  });
});

describe("recordLoginAttempt", () => {
  beforeEach(() => {
    create.mockReset().mockResolvedValue({});
    deleteMany.mockReset().mockResolvedValue({ count: 0 });
  });

  it("records the attempt with the given identifier, ip, and outcome", async () => {
    await recordLoginAttempt("a@example.com", "1.2.3.4", false);
    expect(create).toHaveBeenCalledWith({ data: { identifier: "a@example.com", ipAddress: "1.2.3.4", succeeded: false } });
  });

  it("never throws even if best-effort pruning fails", async () => {
    deleteMany.mockRejectedValue(new Error("boom"));
    await expect(recordLoginAttempt("a@example.com", null, true)).resolves.toBeUndefined();
  });
});
