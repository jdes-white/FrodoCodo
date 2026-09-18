import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";

const ORIGINAL_ENV = { ...process.env };
const VALID_KEY = randomBytes(32).toString("base64");

const updateMock = vi.fn();
const findUniqueOrThrowMock = vi.fn();

vi.mock("../index.js", () => ({
  prisma: {
    financialConnection: {
      update: (...args: unknown[]) => updateMock(...args),
      findUniqueOrThrow: (...args: unknown[]) => findUniqueOrThrowMock(...args),
    },
  },
}));

// Imported after the mock so it picks up the mocked prisma binding.
const { storeConnectionTokens, readConnectionTokens, clearConnectionTokens } = await import("../connectionTokenStorage.js");

describe("connectionTokenStorage (Task 7A credential storage)", () => {
  beforeEach(() => {
    process.env.APP_ENCRYPTION_KEY = VALID_KEY;
    updateMock.mockReset();
    findUniqueOrThrowMock.mockReset();
  });
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("encrypts tokens before writing them, never storing plaintext", async () => {
    await storeConnectionTokens("conn_1", {
      accessToken: "mock-access-token-not-real",
      refreshToken: "mock-refresh-token-not-real",
      expiresAt: new Date("2026-09-01T00:00:00Z"),
    });

    expect(updateMock).toHaveBeenCalledTimes(1);
    const [{ data }] = updateMock.mock.calls[0]!;

    expect(JSON.stringify(data)).not.toContain("mock-access-token-not-real");
    expect(JSON.stringify(data)).not.toContain("mock-refresh-token-not-real");
    expect(data.accessTokenEncrypted).toMatchObject({ v: 1, alg: "aes-256-gcm" });
    expect(data.refreshTokenEncrypted).toMatchObject({ v: 1, alg: "aes-256-gcm" });
    expect(data.tokenExpiresAt).toEqual(new Date("2026-09-01T00:00:00Z"));
  });

  it("round-trips a stored token back to its exact original value", async () => {
    await storeConnectionTokens("conn_1", { accessToken: "mock-access-token", refreshToken: "mock-refresh-token" });
    const stored = updateMock.mock.calls[0]![0].data;

    findUniqueOrThrowMock.mockResolvedValue({
      accessTokenEncrypted: stored.accessTokenEncrypted,
      refreshTokenEncrypted: stored.refreshTokenEncrypted,
      tokenExpiresAt: stored.tokenExpiresAt ?? null,
    });

    const result = await readConnectionTokens("conn_1");
    expect(result).toEqual({ accessToken: "mock-access-token", refreshToken: "mock-refresh-token", expiresAt: null });
  });

  it("returns null when no token has ever been stored (e.g. MockProvider)", async () => {
    findUniqueOrThrowMock.mockResolvedValue({ accessTokenEncrypted: null, refreshTokenEncrypted: null, tokenExpiresAt: null });
    expect(await readConnectionTokens("conn_1")).toBeNull();
  });

  it("clears every token field on disconnect", async () => {
    await clearConnectionTokens("conn_1");
    expect(updateMock).toHaveBeenCalledWith({
      where: { id: "conn_1" },
      data: { accessTokenEncrypted: null, refreshTokenEncrypted: null, tokenExpiresAt: null },
    });
  });

  it("fails closed in production when the encryption key is missing, rather than storing a token unencrypted", async () => {
    delete process.env.APP_ENCRYPTION_KEY;
    process.env.NODE_ENV = "production";
    await expect(storeConnectionTokens("conn_1", { accessToken: "mock-access-token" })).rejects.toThrow(/APP_ENCRYPTION_KEY/);
  });

  it("throws rather than returning a stale/plaintext value when decryption fails (wrong key)", async () => {
    await storeConnectionTokens("conn_1", { accessToken: "mock-access-token" });
    const stored = updateMock.mock.calls[0]![0].data;

    // Simulate a key rotation: the stored envelope was encrypted with the
    // old key, but the running process now has a different one.
    process.env.APP_ENCRYPTION_KEY = randomBytes(32).toString("base64");
    findUniqueOrThrowMock.mockResolvedValue({
      accessTokenEncrypted: stored.accessTokenEncrypted,
      refreshTokenEncrypted: null,
      tokenExpiresAt: null,
    });

    await expect(readConnectionTokens("conn_1")).rejects.toThrow();
  });
});
