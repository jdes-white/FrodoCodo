import { randomUUID } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
import { prisma } from "@frodocodo/db";

/**
 * Categorisation reliability fixes from the audit (see the read-only audit
 * report earlier in this session): allocation-less category visibility,
 * persisted classification best-guess, real learned merchant mapping, and
 * "always classify this way" applying to safe sibling transactions.
 *
 * These tests fabricate transaction/merchant/category fixtures directly
 * via Prisma rather than only through the UI — some of the scenarios
 * (a category with no current-period allocation, a transaction carrying a
 * pre-computed classification suggestion) have no UI path that produces
 * them, since they're states the real ingestion pipeline creates, not
 * something a household clicks into existence. Every fixture is created
 * and torn down inside the test itself (try/finally) so a failure doesn't
 * leave stray rows behind for later tests in this single shared dev DB
 * (playwright.config.ts: fullyParallel: false, workers: 1).
 */

const ADMIN_EMAIL = "admin@frodocodo.household";
const ADMIN_PASSWORD = "frodocodo-demo";

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(ADMIN_EMAIL);
  await page.getByLabel("Password").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL("/");
}

async function getFixtureContext() {
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: ADMIN_EMAIL }, include: { memberships: true } });
  const householdId = admin.memberships[0]!.householdId;
  const account = await prisma.account.findFirstOrThrow({ where: { connection: { householdId } } });
  return { householdId, accountId: account.id };
}

function todayISODate(): string {
  return new Date().toISOString().slice(0, 10);
}

async function createFixtureMerchant(householdId: string) {
  return prisma.merchant.create({
    data: { householdId, normalizedName: "E2E Fixture Merchant", matchKey: `e2e-fixture-merchant-${randomUUID()}` },
  });
}

async function createFixtureTransaction(params: {
  accountId: string;
  amount: number;
  categoryId?: string | null;
  normalizedMerchantId?: string;
  classificationSource?: "USER" | "RULE";
  suggestedCategoryId?: string;
  suggestedCategorySource?: "PROVIDER" | "LEARNED_MAPPING";
  suggestedCategoryConfidence?: number;
  description?: string;
}) {
  return prisma.transaction.create({
    data: {
      accountId: params.accountId,
      transactionDate: new Date(todayISODate()),
      amount: params.amount,
      direction: "DEBIT",
      status: "POSTED",
      originalDescription: params.description ?? "E2E fixture transaction",
      categoryId: params.categoryId ?? null,
      normalizedMerchantId: params.normalizedMerchantId,
      classificationSource: params.classificationSource,
      classificationConfidence: params.classificationSource ? 1 : undefined,
      suggestedCategoryId: params.suggestedCategoryId,
      suggestedCategorySource: params.suggestedCategorySource,
      suggestedCategoryConfidence: params.suggestedCategoryConfidence,
    },
  });
}

async function cleanupTransactions(ids: string[]) {
  if (ids.length === 0) return;
  await prisma.transaction.deleteMany({ where: { id: { in: ids } } });
}

function parseAUD(text: string): number {
  return Number(text.replace(/[^0-9.-]/g, ""));
}

test.describe("Categorisation reliability", () => {
  test("a category with spend but no current-period allocation still appears, in its correct bucket, without fabricating or double-counting spend", async ({ page }) => {
    const { householdId, accountId } = await getFixtureContext();
    const essentials = await prisma.budgetBucket.findFirstOrThrow({ where: { householdId, name: "Essentials" } });
    const categoryName = `E2E No-Allocation ${randomUUID().slice(0, 8)}`;

    const category = await prisma.category.create({
      data: { householdId, bucketId: essentials.id, name: categoryName, spendingType: "FLEXIBLE" },
    });

    try {
      // Deliberately no BudgetAllocation row for the current period — this
      // is exactly the state that used to make a category's spend
      // disappear from every bucket total.
      const tx = await createFixtureTransaction({ accountId, amount: 42.5, categoryId: category.id, description: "E2E no-allocation fixture" });

      try {
        await login(page);
        await page.goto(`/plan/buckets/${essentials.id}`);

        await expect(page.getByText(categoryName, { exact: true })).toBeVisible();
        // "$42.50 of $0.00" — the exact category row text (bucket-detail
        // page renders "{spentToDate} of {allocation}"). Exactly $42.50,
        // not $85.00, proves this spend was counted once, not twice.
        const categoryRow = page.getByText(categoryName, { exact: true }).locator("../..");
        await expect(categoryRow).toContainText("$42.50 of $0.00");
      } finally {
        await cleanupTransactions([tx.id]);
      }
    } finally {
      await prisma.category.delete({ where: { id: category.id } });
    }
  });

  test("an uncategorised transaction is excluded from spend totals until it's confirmed with a real category", async ({ page }) => {
    const { householdId, accountId } = await getFixtureContext();
    const utilities = await prisma.category.findFirstOrThrow({ where: { householdId, name: "Utilities" } });

    await login(page);
    await page.goto("/");
    await page.locator("section").first().waitFor();
    const remainingBefore = parseAUD((await page.getByText("remaining of").locator("..").locator("p").first().textContent()) ?? "");

    const tx = await createFixtureTransaction({ accountId, amount: 55, categoryId: null, description: "E2E uncategorised fixture" });
    try {
      await page.goto("/");
      await page.locator("section").first().waitFor();
      const remainingWhileUncategorised = parseAUD((await page.getByText("remaining of").locator("..").locator("p").first().textContent()) ?? "");
      expect(remainingWhileUncategorised).toBeCloseTo(remainingBefore, 2);

      await page.goto(`/transactions/${tx.id}`);
      await page.locator('select[name="categoryId"]').selectOption(utilities.id);
      await page.getByRole("button", { name: "Save", exact: true }).click();
      // Save/Back flow fix: a successful save now redirects (no `from`
      // context here since this test navigated to the detail page
      // directly) — waiting for that navigation is what proves the
      // mutation landed before the DB read below, replacing the old
      // same-page "Classified by" text check.
      await expect(page).toHaveURL("/transactions");

      await page.goto("/");
      await page.locator("section").first().waitFor();
      const remainingAfterConfirmed = parseAUD((await page.getByText("remaining of").locator("..").locator("p").first().textContent()) ?? "");
      expect(remainingBefore - remainingAfterConfirmed).toBeCloseTo(55, 2);
    } finally {
      await cleanupTransactions([tx.id]);
    }
  });

  test("a persisted best-guess reaches the reclassify UI as a preselected, still-uncategorised suggestion", async ({ page }) => {
    const { householdId, accountId } = await getFixtureContext();
    const utilities = await prisma.category.findFirstOrThrow({ where: { householdId, name: "Utilities" } });

    const tx = await createFixtureTransaction({
      accountId,
      amount: 61,
      categoryId: null,
      suggestedCategoryId: utilities.id,
      suggestedCategorySource: "PROVIDER",
      suggestedCategoryConfidence: 0.45,
      description: "E2E best-guess fixture",
    });

    try {
      await login(page);
      await page.goto(`/transactions/${tx.id}`);

      // Scoped to the suggestion paragraph itself — "Essentials · Utilities"
      // also appears as plain option text inside the category <select>
      // below, so matching it via a fresh page-wide getByText would hit
      // both and throw a strict-mode violation.
      const suggestionHint = page.getByText(/Needs review — best guess is/);
      await expect(suggestionHint).toBeVisible();
      await expect(suggestionHint).toContainText("Essentials · Utilities");
      await expect(suggestionHint).toContainText("45% confidence");

      // Preselected, but not applied — the transaction is still uncategorised until Save.
      await expect(page.locator('select[name="categoryId"]')).toHaveValue(utilities.id);
      const stillUncategorised = await prisma.transaction.findUniqueOrThrow({ where: { id: tx.id } });
      expect(stillUncategorised.categoryId).toBeNull();
    } finally {
      await cleanupTransactions([tx.id]);
    }
  });

  test("one-off correction does not prematurely teach the merchant", async ({ page }) => {
    const { householdId, accountId } = await getFixtureContext();
    const dining = await prisma.category.findFirstOrThrow({ where: { householdId, name: "Dining & Takeaway" } });
    const merchant = await createFixtureMerchant(householdId);
    const tx = await createFixtureTransaction({ accountId, amount: 25, normalizedMerchantId: merchant.id, description: "E2E one-off correction" });

    try {
      await login(page);
      await page.goto(`/transactions/${tx.id}`);
      await page.locator('select[name="categoryId"]').selectOption(dining.id);
      // "Always classify this way" left unchecked.
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await expect(page).toHaveURL("/transactions"); // proves the mutation landed before we read the DB below

      const refreshedMerchant = await prisma.merchant.findUniqueOrThrow({ where: { id: merchant.id } });
      expect(refreshedMerchant.defaultCategoryId).toBeNull();
      const rule = await prisma.merchantRule.findUnique({ where: { householdId_merchantId: { householdId, merchantId: merchant.id } } });
      expect(rule).toBeNull();
    } finally {
      await cleanupTransactions([tx.id]);
      await prisma.merchant.delete({ where: { id: merchant.id } });
    }
  });

  test("three repeated confirmed corrections to the same category establish a learned merchant mapping", async ({ page }) => {
    const { householdId, accountId } = await getFixtureContext();
    const dining = await prisma.category.findFirstOrThrow({ where: { householdId, name: "Dining & Takeaway" } });
    const merchant = await createFixtureMerchant(householdId);
    const txs = await Promise.all(
      [1, 2, 3].map((n) => createFixtureTransaction({ accountId, amount: 10 + n, normalizedMerchantId: merchant.id, description: `E2E learned-mapping fixture ${n}` })),
    );

    try {
      await login(page);
      for (const tx of txs) {
        await page.goto(`/transactions/${tx.id}`);
        await page.locator('select[name="categoryId"]').selectOption(dining.id);
        // Never checking "always classify this way" — the mapping must come from repetition, not an explicit rule.
        await page.getByRole("button", { name: "Save", exact: true }).click();
        await expect(page).toHaveURL("/transactions");
      }

      const refreshedMerchant = await prisma.merchant.findUniqueOrThrow({ where: { id: merchant.id } });
      expect(refreshedMerchant.defaultCategoryId).toBe(dining.id);
      const rule = await prisma.merchantRule.findUnique({ where: { householdId_merchantId: { householdId, merchantId: merchant.id } } });
      expect(rule).toBeNull(); // learned, not an explicit rule
    } finally {
      await cleanupTransactions(txs.map((t) => t.id));
      await prisma.merchant.delete({ where: { id: merchant.id } });
    }
  });

  test("'always classify this way' reclassifies unresolved siblings from the same merchant, but never a transaction the household already categorised differently", async ({
    page,
  }) => {
    const { householdId, accountId } = await getFixtureContext();
    const groceries = await prisma.category.findFirstOrThrow({ where: { householdId, name: "Groceries" } });
    const fuel = await prisma.category.findFirstOrThrow({ where: { householdId, name: "Fuel" } });
    const merchant = await createFixtureMerchant(householdId);

    const target = await createFixtureTransaction({ accountId, normalizedMerchantId: merchant.id, amount: 30, description: "E2E sibling target" });
    const unresolvedSibling = await createFixtureTransaction({ accountId, normalizedMerchantId: merchant.id, amount: 31, description: "E2E unresolved sibling" });
    const exception = await createFixtureTransaction({
      accountId,
      normalizedMerchantId: merchant.id,
      amount: 32,
      categoryId: fuel.id,
      classificationSource: "USER",
      description: "E2E already-categorised exception",
    });

    try {
      await login(page);
      await page.goto(`/transactions/${target.id}`);
      await page.locator('select[name="categoryId"]').selectOption(groceries.id);
      await page.getByLabel(/Always classify .* this way/).check();
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await expect(page).toHaveURL("/transactions");

      const refreshedSibling = await prisma.transaction.findUniqueOrThrow({ where: { id: unresolvedSibling.id } });
      expect(refreshedSibling.categoryId).toBe(groceries.id);
      expect(refreshedSibling.classificationSource).toBe("RULE");

      // The transaction the household had already explicitly categorised differently is untouched.
      const refreshedException = await prisma.transaction.findUniqueOrThrow({ where: { id: exception.id } });
      expect(refreshedException.categoryId).toBe(fuel.id);
      expect(refreshedException.classificationSource).toBe("USER");

      const rule = await prisma.merchantRule.findUniqueOrThrow({ where: { householdId_merchantId: { householdId, merchantId: merchant.id } } });
      expect(rule.categoryId).toBe(groceries.id);
    } finally {
      await cleanupTransactions([target.id, unresolvedSibling.id, exception.id]);
      await prisma.merchant.delete({ where: { id: merchant.id } });
    }
  });
});
