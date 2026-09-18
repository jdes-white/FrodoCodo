import { test, expect, type Page } from "@playwright/test";

/**
 * Home Page 2 bucket-card integration: upcoming commitments now surface
 * inside each bucket's own card (a compact due line + tap-to-expand bottom
 * sheet) instead of a single separate "Coming Up" widget — see
 * apps/web/components/BucketCard.tsx and app/(app)/page.tsx. These tests
 * exercise the real UI end to end; the wording/window-filtering arithmetic
 * itself is covered exactly in
 * packages/domain/src/__tests__/commitments.test.ts against deterministic
 * inputs.
 *
 * Same known-empty-baseline pattern as commitments.spec.ts (this repo's
 * Playwright config runs single-worker against one shared dev DB) — every
 * test clears the household's commitments first, then builds exactly the
 * data it needs.
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

function isoDate(daysFromNow: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysFromNow);
  return d.toISOString().slice(0, 10);
}

/**
 * Waits for the row count to actually drop after each removal rather than
 * just for the edit form to collapse — see commitments.spec.ts's
 * clearAllCommitments doc comment for why the two can race.
 */
async function clearAllCommitments(page: Page) {
  await page.goto("/commitments");
  const rows = page.locator("main button").filter({ hasNotText: "+ Add a commitment" });
  for (let i = 0; i < 50; i++) {
    const countBefore = await rows.count();
    if (countBefore === 0) break;
    await rows.first().click();
    await page.getByRole("button", { name: "Remove" }).click();
    await expect(rows).toHaveCount(countBefore - 1);
  }
}

async function addCommitment(page: Page, { name, amount, days, category }: { name: string; amount: string; days: number; category: string }) {
  await page.getByText("+ Add a commitment").click();
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Amount").fill(amount);
  await page.getByLabel("Expected date").fill(isoDate(days));
  await page.getByLabel("Category").selectOption({ label: category });
  await page.getByRole("button", { name: "Add commitment" }).click();
  await expect(page.getByText(name, { exact: true })).toBeVisible();
  await expect(page.getByText("+ Add a commitment")).toBeVisible();
}

/** The whole bucket card (Card > Link > ... plus the sibling due-line button), found via its unique bucket-name text. */
function bucketCard(page: Page, bucketName: string) {
  return page.getByText(bucketName, { exact: true }).locator("../../..");
}

async function goHome(page: Page) {
  await page.goto("/");
  await page.locator("section").first().waitFor();
}

test.describe("Home Page 2 bucket-card upcoming commitments", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await clearAllCommitments(page);
  });

  test("commitments roll up into the correct bucket, only within the next 7 days, summed correctly, and untouched buckets show no due line", async ({
    page,
  }) => {
    await addCommitment(page, { name: "Insurance bill", amount: "130", days: 3, category: "Insurance" });
    await addCommitment(page, { name: "Utilities bill", amount: "90", days: 6, category: "Utilities" });
    await addCommitment(page, { name: "Family outing", amount: "75", days: 1, category: "Family & Household" });
    await addCommitment(page, { name: "Way out subscription", amount: "50", days: 10, category: "Subscriptions" }); // outside the 7-day window

    await goHome(page);

    const essentials = bucketCard(page, "Essentials");
    await expect(essentials).toContainText("$220.00");
    await expect(essentials).toContainText("due in the next 7 days");

    const family = bucketCard(page, "Family & Household");
    await expect(family).toContainText("$75.00");
    await expect(family).toContainText("due tomorrow");

    // Only commitment in this bucket is outside the 7-day window — the
    // card must look exactly as it did before this feature, with no due
    // line and no calendar icon at all.
    const lifestyle = bucketCard(page, "Lifestyle & Discretionary");
    await expect(lifestyle.getByRole("button")).toHaveCount(0);
    await expect(lifestyle).not.toContainText("due");

    // No commitments assigned to this bucket's category at all.
    const savings = bucketCard(page, "Savings & Goals");
    await expect(savings.getByRole("button")).toHaveCount(0);
  });

  test("tapping the due line expands the bucket's upcoming commitments sorted by due date, supports the existing edit flow, and preselects a category when adding", async ({
    page,
  }) => {
    await addCommitment(page, { name: "Insurance bill", amount: "130", days: 5, category: "Insurance" });
    await addCommitment(page, { name: "Fuel top-up", amount: "90", days: 2, category: "Fuel" });

    await goHome(page);

    const essentials = bucketCard(page, "Essentials");
    await essentials.getByRole("button").click();

    await expect(page.getByRole("heading", { name: "Upcoming in Essentials" })).toBeVisible();
    await expect(page.getByText("$220.00 total in the next 7 days")).toBeVisible();

    // Sorted soonest-first: Fuel top-up (2 days) before Insurance bill (5 days).
    const rowNames = page.locator("main button p.truncate, div[role='dialog'] button p.truncate");
    const sheetText = await page.locator("div[role='dialog']").innerText();
    expect(sheetText.indexOf("Fuel top-up")).toBeGreaterThanOrEqual(0);
    expect(sheetText.indexOf("Fuel top-up")).toBeLessThan(sheetText.indexOf("Insurance bill"));
    void rowNames;

    // Tapping an individual commitment opens the existing tap-to-edit flow.
    await page.getByText("Fuel top-up", { exact: true }).click();
    await expect(page.getByLabel("Name")).toHaveValue("Fuel top-up");
    await expect(page.getByRole("button", { name: "Save" })).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();

    // "+ Add commitment" preselects a category for this bucket (its first
    // category by name — "Fuel" among Essentials' categories) while
    // leaving the dropdown fully editable.
    await page.getByText("+ Add commitment", { exact: true }).click();
    const selectedCategory = await page.getByLabel("Category").locator("option:checked").textContent();
    expect(selectedCategory?.trim()).toBe("Fuel");
    await page.getByRole("button", { name: "Cancel" }).click();

    // "View all upcoming commitments" inside the sheet opens the existing
    // full management screen — scoped to the dialog since the page
    // underneath the (still-open) sheet has its own permanent link with
    // the same text (ViewAllCommitmentsLink).
    await page.locator("div[role='dialog']").getByText("View all upcoming commitments", { exact: true }).click();
    await expect(page).toHaveURL("/commitments");
    await expect(page.getByRole("heading", { name: "Upcoming commitments" })).toBeVisible();
  });

  test("the compact link below the bucket cards opens the full commitments screen", async ({ page }) => {
    await goHome(page);
    await page.getByText("View all upcoming commitments", { exact: true }).click();
    await expect(page).toHaveURL("/commitments");
    await expect(page.getByRole("heading", { name: "Upcoming commitments" })).toBeVisible();
  });
});
