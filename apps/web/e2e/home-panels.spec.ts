import { test, expect, type Page } from "@playwright/test";

/**
 * Verifies the paginated-Home requirements specifically: each of the two
 * panels fits the viewport above the fixed nav with no internal scroll, the
 * surrounding page itself doesn't scroll (only the panel container does),
 * scroll-snap is actually engaged (not just visually close), and the
 * pagination dots exist on mobile but not on desktop/tablet.
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

for (const viewport of MOBILE_VIEWPORTS) {
  test.describe(`Home panels at ${viewport.name} (${viewport.width}x${viewport.height})`, () => {
    test.use({ viewport });

    test("the page itself does not scroll — only the panel container does, and each panel fits without internal overflow", async ({ page }) => {
      await login(page);

      // The outer document must not be independently scrollable — if it
      // were, "swiping" could move the whole page instead of snapping
      // cleanly between panels, and the header/nav could drift out of place.
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
      for (const panel of panelMetrics!.panels) {
        // A panel's own content must not exceed its box — no internal scrolling.
        expect(panel.scrollHeight - panel.clientHeight).toBeLessThanOrEqual(1);
      }
    });

    test("shows exactly two pagination dots", async ({ page }) => {
      await login(page);
      // The dots are decorative (aria-hidden) spans inside the absolutely
      // positioned indicator — count them via a stable structural selector.
      const dotCount = await page.evaluate(() => {
        const indicator = document.querySelector('[aria-hidden="true"].pointer-events-none');
        return indicator ? indicator.children.length : 0;
      });
      expect(dotCount).toBe(2);
    });

    test("scrolling the panel container by one viewport reveals Panel 2's content", async ({ page }) => {
      await login(page);
      await expect(page.getByText("remaining of")).toBeVisible();

      await page.evaluate(() => {
        const container = document.querySelectorAll("section")[0]?.parentElement;
        container?.scrollBy({ top: container.clientHeight, behavior: "instant" as ScrollBehavior });
      });
      await page.waitForTimeout(150);

      await expect(page.getByText("Where's it going?")).toBeVisible();
    });
  });
}

test.describe("Home panels on desktop — pagination metaphor not forced", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("both panels render as normal stacked content, no snap container, no dots", async ({ page }) => {
    await login(page);

    await expect(page.getByText("remaining of")).toBeVisible();
    await expect(page.getByText("Where's it going?")).toBeVisible();

    const scrollSnapType = await page.evaluate(() => {
      const container = document.querySelectorAll("section")[0]?.parentElement;
      return container ? getComputedStyle(container).scrollSnapType : null;
    });
    expect(scrollSnapType).toBe("none");

    const dotsVisible = await page.evaluate(() => {
      const indicator = document.querySelector('[aria-hidden="true"].pointer-events-none');
      return indicator ? getComputedStyle(indicator).display !== "none" : false;
    });
    expect(dotsVisible).toBe(false);
  });
});
