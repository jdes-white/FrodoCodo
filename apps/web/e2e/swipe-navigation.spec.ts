import { test, expect, type Page } from "@playwright/test";

/**
 * Horizontal swipe-to-navigate between the six primary destinations
 * (components/SwipeNavigation.tsx). Playwright has no built-in swipe
 * gesture helper, so these dispatch real synthetic TouchEvents in-page —
 * the same events the component's onTouchStart/onTouchEnd handlers
 * respond to — rather than mouse drags, which wouldn't trigger touch
 * handlers at all.
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

/** Dispatches a synthetic touchstart at (startX, startY) — optionally
 * targeting a specific element, to test the interactive-element
 * exclusion — followed by a touchend at (endX, endY), matching exactly
 * what SwipeNavigation listens for (it doesn't track touchmove). */
async function swipe(page: Page, options: { startX: number; startY: number; endX: number; endY: number; targetSelector?: string }) {
  await page.evaluate((opts) => {
    function dispatch(type: string, x: number, y: number, target: Element) {
      const touch = new Touch({ identifier: 1, target, clientX: x, clientY: y, pageX: x, pageY: y });
      const event = new TouchEvent(type, {
        touches: type === "touchend" ? [] : [touch],
        targetTouches: type === "touchend" ? [] : [touch],
        changedTouches: [touch],
        bubbles: true,
        cancelable: true,
      });
      target.dispatchEvent(event);
    }

    const startTarget = opts.targetSelector ? document.querySelector(opts.targetSelector) : document.elementFromPoint(opts.startX, opts.startY);
    const endTarget = document.elementFromPoint(opts.endX, opts.endY) ?? startTarget;
    if (!startTarget || !endTarget) throw new Error("swipe: could not resolve a touch target");

    dispatch("touchstart", opts.startX, opts.startY, startTarget);
    dispatch("touchend", opts.endX, opts.endY, endTarget);
  }, options);
}

test.describe("Horizontal swipe navigation", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test("swiping left from Home goes to the next destination (Transactions)", async ({ page }) => {
    await login(page);
    await expect(page).toHaveURL("/");

    await swipe(page, { startX: 300, startY: 400, endX: 40, endY: 400 });
    await expect(page).toHaveURL("/transactions");
    // Let the icon badge's CSS color transition finish before reading it.
    await page.waitForTimeout(250);

    // The bottom nav's active state moves with it — the new destination's
    // icon badge picks up the accent background, Home's no longer does.
    const nav = page.locator("nav");
    const transactionsBg = await nav.getByRole("link", { name: /Transactions/ }).evaluate((el) => getComputedStyle(el.querySelector("span")!).backgroundColor);
    const homeBg = await nav.getByRole("link", { name: "Home", exact: true }).evaluate((el) => getComputedStyle(el.querySelector("span")!).backgroundColor);
    expect(transactionsBg).not.toBe("rgba(0, 0, 0, 0)");
    expect(homeBg).toBe("rgba(0, 0, 0, 0)");
  });

  test("swiping right goes to the previous destination", async ({ page }) => {
    await login(page);
    await page.goto("/plan");

    await swipe(page, { startX: 40, startY: 400, endX: 320, endY: 400 });
    await expect(page).toHaveURL("/insights");
  });

  test("does not wrap past the first or last destination", async ({ page }) => {
    await login(page);
    await expect(page).toHaveURL("/");

    // Swipe right (= previous) on Home, the first destination — nothing before it.
    await swipe(page, { startX: 40, startY: 400, endX: 320, endY: 400 });
    await expect(page).toHaveURL("/");

    await page.goto("/settings");
    // Swipe left (= next) on Settings, the last destination — nothing after it.
    await swipe(page, { startX: 300, startY: 400, endX: 40, endY: 400 });
    await expect(page).toHaveURL("/settings");
  });

  test("a mostly-vertical gesture does not trigger a page swipe", async ({ page }) => {
    await login(page);
    await expect(page).toHaveURL("/");

    // Large vertical travel, small horizontal travel — direction lock should reject this.
    await swipe(page, { startX: 200, startY: 200, endX: 230, endY: 600 });
    await expect(page).toHaveURL("/");
  });

  test("a horizontal drag that starts on an interactive control (the North Star dial) does not trigger page navigation", async ({ page }) => {
    await login(page);
    await page.goto("/north-star");
    await expect(page.locator('input[type="range"]')).toBeVisible();

    await swipe(page, { startX: 200, startY: 300, endX: 40, endY: 300, targetSelector: 'input[type="range"]' });
    await expect(page).toHaveURL("/north-star");
  });

  test("tapping a nav item still navigates directly", async ({ page }) => {
    await login(page);
    await page.getByRole("link", { name: /Insights/ }).click();
    await expect(page).toHaveURL("/insights");
  });
});
