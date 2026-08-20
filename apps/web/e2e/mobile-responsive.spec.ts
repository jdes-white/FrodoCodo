import { test, expect, type Page } from "@playwright/test";

/**
 * Guards against the "feels like a desktop site zoomed onto a phone"
 * regression: every page must fit the viewport width with no horizontal
 * scrollbar/pan, at a representative narrow iPhone width (iPhone SE, the
 * narrowest common size still in circulation) and a more typical modern
 * width (iPhone 12/13/14). If any element pokes past the viewport,
 * `scrollWidth` exceeds `clientWidth` and these assertions catch it.
 */

const ADMIN_EMAIL = "admin@frodocodo.household";
const ADMIN_PASSWORD = "frodocodo-demo";

const VIEWPORTS = [
  { name: "iPhone SE", width: 375, height: 667 },
  { name: "iPhone 14", width: 390, height: 844 },
];

async function expectNoHorizontalOverflow(page: Page) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth, `scrollWidth (${scrollWidth}) should not exceed clientWidth (${clientWidth})`).toBeLessThanOrEqual(clientWidth);
}

async function login(page: Page) {
  await page.goto("/login");
  await expectNoHorizontalOverflow(page);
  await page.getByLabel("Email").fill(ADMIN_EMAIL);
  await page.getByLabel("Password").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL("/");
}

for (const viewport of VIEWPORTS) {
  test.describe(`no horizontal overflow at ${viewport.name} (${viewport.width}x${viewport.height})`, () => {
    test.use({ viewport });

    test("login, dashboard, transactions, transaction detail, plan, insights, settings", async ({ page }) => {
      await login(page);

      // Dashboard
      await expectNoHorizontalOverflow(page);

      // Bucket drill-down (still part of the dashboard->detail flow)
      const bucketCard = page.getByText("Essentials").first();
      if (await bucketCard.count()) {
        await bucketCard.click();
        await expectNoHorizontalOverflow(page);
      }

      // Transactions
      await page.goto("/transactions");
      await expectNoHorizontalOverflow(page);

      // Transaction detail, if any transactions exist
      const firstTransaction = page.locator('a[href^="/transactions/"]').first();
      if (await firstTransaction.count()) {
        await firstTransaction.click();
        await expectNoHorizontalOverflow(page);
      }

      // Plan (budget editor + What If scenario modeller)
      await page.goto("/plan");
      await expectNoHorizontalOverflow(page);

      // Insights
      await page.goto("/insights");
      await expectNoHorizontalOverflow(page);

      // Settings
      await page.goto("/settings");
      await expectNoHorizontalOverflow(page);
    });
  });
}
