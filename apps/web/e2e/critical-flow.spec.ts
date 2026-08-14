import { test, expect } from "@playwright/test";

/**
 * The critical end-to-end flow (§52): connect/import (done by the mock
 * provider + seed script — see packages/db/prisma/seed.ts) -> categorize ->
 * budget calculation -> dashboard -> drill-down. Requires the app running
 * against a freshly-seeded database (`pnpm db:seed`) at localhost:3000.
 */

const ADMIN_EMAIL = "admin@frodocodo.household";
const ADMIN_PASSWORD = "frodocodo-demo";

test("household can log in, see budget position, drill into a bucket, and reclassify a transaction", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(ADMIN_EMAIL);
  await page.getByLabel("Password").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();

  // Dashboard: the primary "where do we stand" answer must render within seconds (§3, §17).
  await expect(page).toHaveURL("/");
  await expect(page.getByText("remaining of")).toBeVisible();
  await expect(page.getByText(/Ahead of pace|Behind pace|On track/).first()).toBeVisible();

  // Bucket-level position is visible on the same screen.
  const bucketCard = page.getByText("Essentials").first();
  await expect(bucketCard).toBeVisible();

  // Drill down: total -> bucket -> transactions (§18).
  await bucketCard.click();
  await expect(page.getByText("Projected to finish")).toBeVisible();

  // Drill down further into an individual transaction, if any exist in this bucket.
  const firstTransaction = page.locator('a[href^="/transactions/"]').first();
  if (await firstTransaction.count()) {
    await firstTransaction.click();
    await expect(page.getByText("Original description")).toBeVisible();
  }

  // Transaction explorer + review queue (§19, §20).
  await page.goto("/transactions?needsReviewOnly=1");
  const reviewItem = page.locator('a[href^="/transactions/"]').first();
  await expect(reviewItem).toBeVisible();
  await reviewItem.click();

  // Reclassify: pick the first real category option and save (§32).
  const select = page.locator('select[name="categoryId"]');
  const options = await select.locator("option").all();
  const firstRealOption = options[1]; // index 0 is the disabled placeholder
  const value = await firstRealOption!.getAttribute("value");
  await select.selectOption(value!);
  await page.getByRole("button", { name: "Save", exact: true }).click();

  // The transaction should no longer show "Needs review" once classified.
  await expect(page.getByText("Needs review")).toHaveCount(0);
});

test("insights page answers a question about the budget without leaving the app", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(ADMIN_EMAIL);
  await page.getByLabel("Password").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL("/");

  await page.goto("/insights");
  await page.getByPlaceholder("Ask a question about your budget…").fill("Why are we behind this month?");
  await page.getByRole("button", { name: "Ask" }).click();

  await expect(page.locator("text=remaining out of")).toBeVisible({ timeout: 10_000 });
});
