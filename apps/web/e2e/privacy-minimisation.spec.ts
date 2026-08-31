import { test, expect } from "@playwright/test";
import { prisma } from "@frodocodo/db";

/**
 * Task 6B privacy enforcement: proves the real, deployed seed/ingestion
 * path (not just the ledger's allow-list function in isolation — that's
 * covered by packages/ledger/src/__tests__/ingestion.test.ts) never
 * persists a raw provider payload or a banking-identity-looking account
 * label.
 *
 * This file previously proved security audit finding H3 (the raw payload
 * was encrypted, never plaintext). Task 6A/6B's stronger decision replaced
 * that column entirely: `Transaction.rawProviderPayload` no longer exists
 * in the schema, so there is nothing left to encrypt — data FrodoCodo
 * never retains cannot later leak. See docs/banking-data-minimisation-audit.md.
 */

test.describe("Privacy-first ingestion (Task 6B)", () => {
  test("no rawProviderPayload column exists on Transaction", async () => {
    const columns = await prisma.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'Transaction' AND table_schema = 'public'
    `;
    const columnNames = columns.map((c) => c.column_name);
    expect(columnNames).not.toContain("rawProviderPayload");
    expect(columnNames).not.toContain("institutionTransactionRef");
  });

  test("seeded accounts expose only a short household alias, never a provider account nickname or number-looking string", async () => {
    const accounts = await prisma.account.findMany({ select: { alias: true } });
    expect(accounts.length).toBeGreaterThan(0);

    for (const account of accounts) {
      // No digit runs of 4+ (the shape of an account number or a masked
      // "...1234" fragment) anywhere in the alias.
      expect(account.alias).not.toMatch(/\d{4,}/);
      // Short household labels, not full banking product names.
      expect(account.alias.length).toBeLessThanOrEqual(30);
    }
  });

  test("a seeded transaction never carries a raw payload property in its API-facing shape", async () => {
    const transaction = await prisma.transaction.findFirst();
    expect(transaction).not.toBeNull();
    expect(transaction).not.toHaveProperty("rawProviderPayload");
    expect(transaction).not.toHaveProperty("institutionTransactionRef");
  });
});
