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
  // Matches every paceStatusLabel() variant (packages/domain/src/pacePosition.ts),
  // the canonical status pill wording used everywhere in the app now.
  await expect(page.getByText(/Comfortably on track|Ahead of plan|On track|Slightly over pace|Over pace/).first()).toBeVisible();

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
  const reviewItemHref = await reviewItem.getAttribute("href");
  await reviewItem.click();

  // Reclassify: pick the first real category option and save (§32).
  const select = page.locator('select[name="categoryId"]');
  const options = await select.locator("option").all();
  const firstRealOption = options[1]; // index 0 is the disabled placeholder
  const value = await firstRealOption!.getAttribute("value");
  await select.selectOption(value!);
  await page.getByRole("button", { name: "Save", exact: true }).click();

  // Save/Back flow fix: a successful save returns to the exact filtered
  // review list the household drilled in from, rather than leaving them on
  // the detail page with no visible confirmation anything happened.
  await expect(page).toHaveURL("/transactions?needsReviewOnly=1");

  // The just-classified transaction should no longer appear in this
  // filtered view (scoped to its own link rather than a page-wide "Needs
  // review" text search, since other genuinely-unresolved seed items may
  // legitimately still be present).
  const transactionId = reviewItemHref!.split("/transactions/")[1]!.split("?")[0];
  await expect(page.locator(`a[href^="/transactions/${transactionId}"]`)).toHaveCount(0);
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
  // The answer should open with the answer itself, not a "Regarding ...:" preamble.
  await expect(page.locator('text=/^Regarding "/')).toHaveCount(0);
});

test("Plan's What If tool can model both a reduction and an increase, from live budget categories", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(ADMIN_EMAIL);
  await page.getByLabel("Password").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL("/");

  await page.goto("/plan");

  // The category dropdown is populated from this period's real budget categories,
  // not a hard-coded list — it must have at least one real option.
  const categorySelect = page.locator('section:has-text("What if?") select');
  const categoryOptions = await categorySelect.locator("option").all();
  expect(categoryOptions.length).toBeGreaterThan(0);

  // Default is Reduce; switching to Increase changes the resulting copy.
  await expect(page.getByText("freeing up")).toBeVisible();
  await page.getByRole("button", { name: "Increase" }).click();
  await expect(page.getByText("using an extra")).toBeVisible();
});
