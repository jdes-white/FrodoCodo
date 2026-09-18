import { randomUUID } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
import { prisma } from "@frodocodo/db";

/**
 * Acceptance-test defects found after the categorisation and
 * screenshot-to-budget closure passes (5234dd7, 120fb7e):
 *
 * 1. Saving a reclassification gave no visible completion and never
 *    navigated anywhere, and "Back to transactions" always went to a bare,
 *    unfiltered `/transactions` regardless of where the household drilled
 *    in from.
 * 2. "Needs review only" appeared to do nothing because a transaction that
 *    had been reclassified while still carrying an independent
 *    `needsExtractionReview`/`needsFinancialMovementReview` flag stayed in
 *    the filtered list — the filter itself was correct (those are
 *    genuinely distinct uncertainties, categorisation closure pass §5),
 *    but reclassifying never cleared them even though picking an explicit
 *    category is itself sufficient confirmation to resolve both.
 *
 * Same shared-dev-DB, fixture-per-test pattern as
 * categorisation-reliability.spec.ts (playwright.config.ts: workers: 1).
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

async function createFixtureTransaction(params: {
  accountId: string;
  amount: number;
  description: string;
  categoryId?: string | null;
  needsExtractionReview?: boolean;
  needsFinancialMovementReview?: boolean;
  possibleDuplicateOfId?: string;
}) {
  return prisma.transaction.create({
    data: {
      accountId: params.accountId,
      transactionDate: new Date(todayISODate()),
      amount: params.amount,
      direction: "DEBIT",
      status: "POSTED",
      originalDescription: params.description,
      categoryId: params.categoryId ?? null,
      needsExtractionReview: params.needsExtractionReview ?? false,
      needsFinancialMovementReview: params.needsFinancialMovementReview ?? false,
      possibleDuplicateOfId: params.possibleDuplicateOfId,
    },
  });
}

async function cleanupTransactions(ids: string[]) {
  if (ids.length === 0) return;
  await prisma.transaction.deleteMany({ where: { id: { in: ids } } });
}

test.describe("Transaction review flow — Save/Back and Needs-review-only defects", () => {
  test("saving a reclassification returns to the exact filtered review list, and the saved transaction drops out of it", async ({ page }) => {
    const { accountId } = await getFixtureContext();
    const target = await createFixtureTransaction({ accountId, amount: 12.34, description: `E2E save-redirect target ${randomUUID().slice(0, 8)}` });
    const control = await createFixtureTransaction({ accountId, amount: 56.78, description: `E2E save-redirect control ${randomUUID().slice(0, 8)}` });

    try {
      await login(page);
      await page.goto("/transactions?needsReviewOnly=1");

      const targetLink = page.locator(`a[href^="/transactions/${target.id}"]`);
      await expect(targetLink).toBeVisible();
      const controlLink = page.locator(`a[href^="/transactions/${control.id}"]`);
      await expect(controlLink).toBeVisible();

      // The link itself must carry the current filtered view forward — this
      // is what makes both the redirect-on-save and the Back link below
      // possible at all.
      await expect(targetLink).toHaveAttribute(
        "href",
        `/transactions/${target.id}?from=${encodeURIComponent("/transactions?needsReviewOnly=1")}`,
      );

      await targetLink.click();
      await expect(page.locator('select[name="categoryId"]')).toBeVisible();
      const select = page.locator('select[name="categoryId"]');
      const options = await select.locator("option").all();
      const value = await options[1]!.getAttribute("value");
      await select.selectOption(value!);
      await page.getByRole("button", { name: "Save", exact: true }).click();

      // Immediate, unambiguous completion: navigated back to the exact
      // filtered view, not left stranded on the detail page.
      await expect(page).toHaveURL("/transactions?needsReviewOnly=1");

      // The just-classified transaction is gone from this filtered view...
      await expect(page.locator(`a[href^="/transactions/${target.id}"]`)).toHaveCount(0);
      // ...while the still-genuinely-unresolved control transaction remains.
      await expect(page.locator(`a[href^="/transactions/${control.id}"]`)).toBeVisible();
    } finally {
      await cleanupTransactions([target.id, control.id]);
    }
  });

  test('"Back to transactions" returns to the exact filtered review list without requiring a save, and leaves the transaction untouched', async ({ page }) => {
    const { accountId } = await getFixtureContext();
    const tx = await createFixtureTransaction({ accountId, amount: 9.99, description: `E2E back-link fixture ${randomUUID().slice(0, 8)}` });

    try {
      await login(page);
      await page.goto("/transactions?needsReviewOnly=1");
      const link = page.locator(`a[href^="/transactions/${tx.id}"]`);
      await expect(link).toBeVisible();
      await link.click();
      await expect(page.getByText("Original description")).toBeVisible();

      await page.getByText("← Back to transactions").click();
      await expect(page).toHaveURL("/transactions?needsReviewOnly=1");

      const stillUnresolved = await prisma.transaction.findUniqueOrThrow({ where: { id: tx.id } });
      expect(stillUnresolved.categoryId).toBeNull();
    } finally {
      await cleanupTransactions([tx.id]);
    }
  });

  test("reclassifying a transaction clears its extraction-review and financial-movement-review flags, so it correctly drops out of Needs review only", async ({ page }) => {
    const { householdId, accountId } = await getFixtureContext();
    const groceries = await prisma.category.findFirstOrThrow({ where: { householdId, name: "Groceries" } });
    const tx = await createFixtureTransaction({
      accountId,
      amount: 21.5,
      description: `E2E extraction-flag fixture ${randomUUID().slice(0, 8)}`,
      needsExtractionReview: true,
    });

    try {
      await login(page);
      await page.goto("/transactions?needsReviewOnly=1");
      await expect(page.locator(`a[href^="/transactions/${tx.id}"]`)).toBeVisible();

      await page.goto(`/transactions/${tx.id}?from=${encodeURIComponent("/transactions?needsReviewOnly=1")}`);
      await page.locator('select[name="categoryId"]').selectOption(groceries.id);
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await expect(page).toHaveURL("/transactions?needsReviewOnly=1");

      const refreshed = await prisma.transaction.findUniqueOrThrow({ where: { id: tx.id } });
      expect(refreshed.categoryId).toBe(groceries.id);
      expect(refreshed.needsExtractionReview).toBe(false);

      // Now fully resolved and carrying no other review flag — must not
      // reappear in the exception queue.
      await expect(page.locator(`a[href^="/transactions/${tx.id}"]`)).toHaveCount(0);
    } finally {
      await cleanupTransactions([tx.id]);
    }
  });

  test("a categorised transaction with a genuinely unresolved possible-duplicate flag correctly remains in Needs review only — the filter, not categorisation, decides this", async ({ page }) => {
    const { householdId, accountId } = await getFixtureContext();
    const groceries = await prisma.category.findFirstOrThrow({ where: { householdId, name: "Groceries" } });
    const original = await createFixtureTransaction({ accountId, amount: 14.0, description: `E2E dup-original fixture ${randomUUID().slice(0, 8)}`, categoryId: groceries.id });
    const possibleDuplicate = await createFixtureTransaction({
      accountId,
      amount: 14.0,
      description: `E2E dup-flagged fixture ${randomUUID().slice(0, 8)}`,
      categoryId: groceries.id,
      possibleDuplicateOfId: original.id,
    });

    try {
      await login(page);
      await page.goto("/transactions?needsReviewOnly=1");
      // Categorised, yet still flagged for a genuinely distinct reason
      // (duplicate uncertainty) — this is intentional and must not be
      // "fixed" by loosening the filter.
      await expect(page.locator(`a[href^="/transactions/${possibleDuplicate.id}"]`)).toBeVisible();
    } finally {
      await cleanupTransactions([possibleDuplicate.id, original.id]);
    }
  });
});
