import { test } from "@playwright/test";

test.skip(!process.env.SCREENSHOT_MODE, "manual visual check only");

test("capture dashboard + insights screenshots", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/login");
  await page.getByLabel("Email").fill("admin@frodocodo.household");
  await page.getByLabel("Password").fill("frodocodo-demo");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("/");
  await page.screenshot({ path: "e2e/__screenshots__/dashboard-mobile.png", fullPage: true });

  await page.goto("/insights");
  await page.screenshot({ path: "e2e/__screenshots__/insights-mobile.png", fullPage: true });

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await page.screenshot({ path: "e2e/__screenshots__/dashboard-desktop.png", fullPage: true });
});
