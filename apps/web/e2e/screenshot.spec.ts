import { test } from "@playwright/test";

test.skip(!process.env.SCREENSHOT_MODE, "manual visual check only");

test("capture a full tour of the app (mobile viewport)", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });

  // 1. Login screen
  await page.goto("/login");
  await page.screenshot({ path: "e2e/__screenshots__/01-login.png" });

  await page.getByLabel("Email").fill("admin@frodocodo.household");
  await page.getByLabel("Password").fill("frodocodo-demo");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("/");

  // 2. Dashboard
  await page.screenshot({ path: "e2e/__screenshots__/02-dashboard.png", fullPage: true });

  // 3. Bucket drill-down
  await page.getByText("Essentials").first().click();
  await page.waitForURL(/\/plan\/buckets\//);
  await page.screenshot({ path: "e2e/__screenshots__/03-bucket-detail.png", fullPage: true });

  // 4. Transaction detail (drill down further from the bucket page, if any transactions shown)
  const firstTransaction = page.locator('a[href^="/transactions/"]').first();
  if (await firstTransaction.count()) {
    await firstTransaction.click();
    await page.waitForURL(/\/transactions\//);
    await page.screenshot({ path: "e2e/__screenshots__/04-transaction-detail.png", fullPage: true });
  }

  // 5. Transactions explorer
  await page.goto("/transactions");
  await page.screenshot({ path: "e2e/__screenshots__/05-transactions.png", fullPage: true });

  // 6. Review queue (needs review filter)
  await page.goto("/transactions?needsReviewOnly=1");
  await page.screenshot({ path: "e2e/__screenshots__/06-review-queue.png", fullPage: true });

  // 7. Insights page
  await page.goto("/insights");
  await page.screenshot({ path: "e2e/__screenshots__/07-insights.png", fullPage: true });

  // 8. Insights - after asking the AI coach a question
  await page.getByPlaceholder("Ask a question about your budget…").fill("Why are we behind this month?");
  await page.getByRole("button", { name: "Ask" }).click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: "e2e/__screenshots__/08-insights-answered.png", fullPage: true });

  // 9. Plan page (budget editor + scenario modeller)
  await page.goto("/plan");
  await page.screenshot({ path: "e2e/__screenshots__/09-plan.png", fullPage: true });

  // 10. Settings page
  await page.goto("/settings");
  await page.screenshot({ path: "e2e/__screenshots__/10-settings.png", fullPage: true });
});
