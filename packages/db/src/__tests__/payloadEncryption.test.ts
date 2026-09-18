import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { encryptForStorage, decryptFromStorage } from "../payloadEncryption";

const ORIGINAL_ENV = { ...process.env };
const VALID_KEY = randomBytes(32).toString("base64");

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("encryptForStorage / decryptFromStorage round-trip", () => {
  beforeEach(() => {
    process.env.APP_ENCRYPTION_KEY = VALID_KEY;
  });

  it("encrypts to an authenticated envelope, never the plaintext shape", () => {
    const payload = { source: "mock", id: "tx_123", description: "WOOLWORTHS 123" };
    const envelope = encryptForStorage(payload);

    expect(envelope).toBeDefined();
    expect(envelope).toMatchObject({ v: 1, alg: "aes-256-gcm" });
    expect(typeof envelope!.iv).toBe("string");
    expect(typeof envelope!.authTag).toBe("string");
    expect(typeof envelope!.ciphertext).toBe("string");
    // The plaintext payload never appears verbatim anywhere in the stored envelope.
    const serialized = JSON.stringify(envelope);
    expect(serialized).not.toContain("WOOLWORTHS");
    expect(serialized).not.toContain("tx_123");
  });

  it("decrypts back to the exact original payload", () => {
    const payload = { source: "mock", id: "tx_456", nested: { amount: 12.34, tags: ["a", "b"] } };
    const envelope = encryptForStorage(payload);
    expect(decryptFromStorage(envelope)).toEqual(payload);
  });

  it("round-trips null/undefined as null, never encrypting an empty payload", () => {
    expect(encryptForStorage(null)).toBeUndefined();
    expect(encryptForStorage(undefined)).toBeUndefined();
    expect(decryptFromStorage(null)).toBeNull();
    expect(decryptFromStorage(undefined)).toBeNull();
  });

  it("uses a fresh random IV for every call, even for the same payload", () => {
    const payload = { a: 1 };
    const first = encryptForStorage(payload)!;
    const second = encryptForStorage(payload)!;
    expect(first.iv).not.toBe(second.iv);
    expect(first.ciphertext).not.toBe(second.ciphertext);
  });

  it("fails closed on decrypt when the ciphertext has been tampered with", () => {
    const envelope = encryptForStorage({ a: 1 })!;
    const tampered = { ...envelope, ciphertext: Buffer.from("tampered-bytes-not-real").toString("base64") };
    expect(() => decryptFromStorage(tampered)).toThrow(/[Ff]ailed to decrypt/);
  });

  it("fails closed on decrypt with the wrong key", () => {
    const envelope = encryptForStorage({ a: 1 })!;
    process.env.APP_ENCRYPTION_KEY = randomBytes(32).toString("base64");
    expect(() => decryptFromStorage(envelope)).toThrow();
  });

  it("rejects a value that isn't a well-formed envelope (e.g. a historical plaintext row)", () => {
    expect(() => decryptFromStorage({ source: "mock", id: "tx_1" })).toThrow(/envelope/);
  });
});

describe("missing key behaviour", () => {
  beforeEach(() => {
    delete process.env.APP_ENCRYPTION_KEY;
  });

  it("outside production: stores nothing (undefined) rather than plaintext", () => {
    process.env.NODE_ENV = "test";
    expect(encryptForStorage({ source: "mock" })).toBeUndefined();
  });

  it("in production: fails closed and throws rather than persisting plaintext", () => {
    process.env.NODE_ENV = "production";
    expect(() => encryptForStorage({ source: "mock" })).toThrow(/APP_ENCRYPTION_KEY/);
  });

  it("decrypt always fails closed when the key is missing, regardless of environment", () => {
    process.env.NODE_ENV = "test";
    expect(() => decryptFromStorage({ v: 1, alg: "aes-256-gcm", iv: "AAAA", authTag: "AAAA", ciphertext: "AAAA" })).toThrow(
      /APP_ENCRYPTION_KEY/,
    );
  });
});

describe("malformed key", () => {
  it("rejects a key that isn't 32 bytes once decoded", () => {
    process.env.APP_ENCRYPTION_KEY = Buffer.from("too-short").toString("base64");
    expect(() => encryptForStorage({ a: 1 })).toThrow(/32 bytes/);
  });
});
