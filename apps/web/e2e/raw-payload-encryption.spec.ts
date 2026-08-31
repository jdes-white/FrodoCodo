import { test, expect } from "@playwright/test";
import { prisma, decryptFromStorage, Prisma } from "@frodocodo/db";

/**
 * Security audit finding H3: Transaction.rawProviderPayload must never be
 * persisted as plaintext. This runs against the real demo household seeded
 * via `pnpm db:seed` (packages/db/src/seedHousehold.ts, which now routes
 * every payload through encryptForStorage — see
 * packages/db/src/payloadEncryption.ts) rather than fabricating its own
 * fixture, so it proves the actual write path used in this deployment, not
 * just the encryption function in isolation (that round-trip is already
 * covered by packages/db/src/__tests__/payloadEncryption.test.ts).
 */

test.describe("Raw provider payload encryption", () => {
  test("seeded transactions store an encrypted envelope, never the plaintext mock shape, and it decrypts back to the original", async () => {
    const withPayload = await prisma.transaction.findFirst({
      where: { rawProviderPayload: { not: Prisma.DbNull } },
      select: { rawProviderPayload: true },
    });

    expect(withPayload).not.toBeNull();
    const stored = withPayload!.rawProviderPayload as Record<string, unknown>;

    // Never the old plaintext mock shape ({ source: "mock", id, description }).
    expect(stored).not.toHaveProperty("description");
    expect(JSON.stringify(stored)).not.toMatch(/WOOLWORTHS|NETFLIX|SALARY/i);

    // It IS the authenticated-encryption envelope shape.
    expect(stored).toMatchObject({ v: 1, alg: "aes-256-gcm" });
    expect(typeof stored.iv).toBe("string");
    expect(typeof stored.authTag).toBe("string");
    expect(typeof stored.ciphertext).toBe("string");

    // And it decrypts back to a real mock payload shape.
    const decrypted = decryptFromStorage(stored) as { source?: string };
    expect(decrypted.source).toBe("mock");
  });
});
