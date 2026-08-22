import { test, expect, type Page } from "@playwright/test";

/**
 * North Star (§19): mobile page-snap/no-overflow (same shape as
 * home-panels.spec.ts, but Page 2 is deliberately allowed to scroll
 * *within itself*), that dragging the dependency dial never mutates the
 * household's stored assumptions, and that an assumption edit on Page 2
 * actually persists.
 */

const ADMIN_EMAIL = "admin@frodocodo.household";
const ADMIN_PASSWORD = "frodocodo-demo";

const MOBILE_VIEWPORTS = [
  { name: "iPhone SE", width: 375, height: 667 },
  { name: "iPhone 14", width: 390, height: 844 },
];

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(ADMIN_EMAIL);
  await page.getByLabel("Password").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL("/");
}

async function scrollToPanel2(page: Page) {
  await page.evaluate(() => {
    const container = document.querySelectorAll("section")[0]?.parentElement;
    container?.scrollBy({ top: container.clientHeight, behavior: "instant" as ScrollBehavior });
  });
  await page.waitForTimeout(150);
}

for (const viewport of MOBILE_VIEWPORTS) {
  test.describe(`North Star panels at ${viewport.name} (${viewport.width}x${viewport.height})`, () => {
    test.use({ viewport });

    test("pages snap between two full-height panels with no page-level scroll", async ({ page }) => {
      await login(page);
      await page.goto("/north-star");
      await expect(page.getByText("Employment dependency today")).toBeVisible();

      const docOverflow = await page.evaluate(() => ({
        scrollHeight: document.documentElement.scrollHeight,
        clientHeight: document.documentElement.clientHeight,
      }));
      expect(docOverflow.scrollHeight - docOverflow.clientHeight).toBeLessThanOrEqual(1);

      const panelMetrics = await page.evaluate(() => {
        const container = document.querySelectorAll("section")[0]?.parentElement;
        if (!container) return null;
        const sections = Array.from(container.children) as HTMLElement[];
        return {
          scrollSnapType: getComputedStyle(container).scrollSnapType,
          panelCount: sections.length,
          panels: sections.map((s) => ({ scrollHeight: s.scrollHeight, clientHeight: s.clientHeight })),
        };
      });

      expect(panelMetrics).not.toBeNull();
      expect(panelMetrics!.panelCount).toBe(2);
      expect(panelMetrics!.scrollSnapType).toContain("mandatory");
      // Each panel *section* fits its box exactly — Page 2's own content can
      // be taller than the viewport, but it scrolls inside a nested wrapper
      // (AssumptionsPanel.tsx's own overflow-y-auto div) rather than
      // expanding the section itself, which is what keeps the outer snap
      // scroll well-defined (§12: never settle halfway between panels).
      for (const panel of panelMetrics!.panels) {
        expect(panel.scrollHeight - panel.clientHeight).toBeLessThanOrEqual(1);
      }
    });

    test("swiping to Page 2 reveals the editable assumptions", async ({ page }) => {
      await login(page);
      await page.goto("/north-star");
      await scrollToPanel2(page);

      await expect(page.getByText("Build your engine")).toBeVisible();
      await expect(page.getByText("Directional projection")).toBeVisible();
    });
  });
}

test.describe("North Star dependency dial", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("dragging the dial explores a level without changing the actual stored dependency figure (§7)", async ({ page }) => {
    await login(page);
    await page.goto("/north-star");

    const actualBefore = await page
      .getByText("Employment dependency today")
      .locator("..")
      .locator("p")
      .first()
      .textContent();

    const slider = page.locator('input[type="range"]');
    await slider.evaluate((el: HTMLInputElement) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
      setter.call(el, "50");
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    });

    // The readout card switches to the freely-dragged value while exploring...
    await expect(page.getByText("To reach 50% or below")).toBeVisible();

    // ...but the actual figure elsewhere on the page never moves.
    const actualAfter = await page
      .getByText("Employment dependency today")
      .locator("..")
      .locator("p")
      .first()
      .textContent();
    expect(actualAfter).toBe(actualBefore);
  });
});

test.describe("North Star assumption editing", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("editing an assumption on Page 2 persists across reload", async ({ page }) => {
    await login(page);
    await page.goto("/north-star");
    await scrollToPanel2(page);

    const row = page.locator("details", { hasText: "Side business" });
    await row.locator("summary").click();
    await row.locator('input[name="value"]').fill("5000");
    await row.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("$5,000.00")).toBeVisible();

    await page.reload();
    await scrollToPanel2(page);
    await expect(page.getByText("$5,000.00")).toBeVisible();

    // Restore the seed value so the demo household is left as re-runnable.
    const restoreRow = page.locator("details", { hasText: "Side business" });
    await restoreRow.locator("summary").click();
    await restoreRow.locator('input[name="value"]').fill("0");
    await restoreRow.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("$0.00")).toBeVisible();
  });
});
