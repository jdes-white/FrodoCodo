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

    test("swiping to Page 2 reveals the compact assumption tiles", async ({ page }) => {
      await login(page);
      await page.goto("/north-star");
      await scrollToPanel2(page);

      await expect(page.getByText("Build your engine")).toBeVisible();
      await expect(page.getByText("Investments")).toBeVisible();
      await expect(page.getByRole("button", { name: /Lifestyle/ })).toBeVisible();
    });
  });
}

/** Drags the invisible range-input dial to `percent`, then fires blur/
 * pointerup too — DependencyDial no longer has any revert-on-release
 * handler at all, but firing these anyway proves that stays true rather
 * than merely "no test ever exercised release". */
async function dragDialTo(page: Page, percent: number) {
  const slider = page.locator('input[type="range"]');
  await slider.evaluate((el: HTMLInputElement, value: number) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
    setter.call(el, String(value));
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("pointerup", { bubbles: true }));
    el.dispatchEvent(new Event("blur", { bubbles: true }));
  }, percent);
}

test.describe("North Star dependency dial — persistent scenario (§7)", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("dragging the dial commits a scenario that survives release, and shows the explored value as the headline while keeping the real figure as a caption", async ({
    page,
  }) => {
    await login(page);
    await page.goto("/north-star");
    await expect(page.getByText("Next milestone: below 90%")).toBeVisible();

    const actualBefore = await page.getByText("Employment dependency today").locator("..").locator("p").first().textContent();

    await dragDialTo(page, 30);

    // The scenario readout replaces the live "next milestone" framing and stays put after release.
    await expect(page.getByText("Scenario: 30% dependency")).toBeVisible();
    await expect(page.getByRole("button", { name: "Reset · Live" })).toBeVisible();

    // The dial's own headline now tracks the explored value, not the live one...
    await expect(page.getByText("Exploring — today:")).toBeVisible();
    // ...while the real, unchanged figure is preserved as a caption underneath it, not lost.
    await expect(page.getByText(`Exploring — today: ${actualBefore}`)).toBeVisible();
  });

  test("supporting cells update to the selected scenario, matching the spec's worked example exactly", async ({ page }) => {
    await login(page);
    await page.goto("/north-star");

    // Seed data: Lifestyle $190,000, current independent income $1,400.
    // At 30% selected dependency: required $133,000, gap $131,600.
    await dragDialTo(page, 30);

    await expect(page.getByText("$190,000.00").first()).toBeVisible(); // Lifestyle to fund — unchanged
    await expect(page.getByText("required for 30% scenario")).toBeVisible();
    await expect(page.getByText("$133,000.00")).toBeVisible(); // Independent income -> required income
    // Dependency -> selected % — scoped to the stat tile, since the dial's
    // own headline now also reads "30%" while this scenario is active.
    const dependencyTileValue = page.getByText("Dependency", { exact: true }).locator("..").locator("..").locator("p").first();
    await expect(dependencyTileValue).toHaveText("30%");
    await expect(page.getByText("Income needed", { exact: true })).toBeVisible();
    await expect(page.getByText("$131,600.00")).toBeVisible(); // replaces "Next milestone"
    await expect(page.getByText("Exploring a 30% dependency scenario")).toBeVisible();
  });

  test("Page 1 -> Page 2 -> Page 1 preserves the selected scenario", async ({ page }) => {
    await login(page);
    await page.goto("/north-star");
    await dragDialTo(page, 30);
    await expect(page.getByText("Scenario: 30% dependency")).toBeVisible();

    await scrollToPanel2(page);
    await expect(page.getByText("Build your engine")).toBeVisible();

    await page.evaluate(() => {
      const container = document.querySelectorAll("section")[0]?.parentElement;
      container?.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
    });
    await page.waitForTimeout(150);

    await expect(page.getByText("Scenario: 30% dependency")).toBeVisible();
  });

  test("navigating to another primary destination resets the scenario to live", async ({ page }) => {
    await login(page);
    await page.goto("/north-star");
    await dragDialTo(page, 30);
    await expect(page.getByText("Scenario: 30% dependency")).toBeVisible();

    await page.getByRole("link", { name: "Home" }).click();
    await expect(page).toHaveURL("/");

    await page.getByRole("link", { name: /North Star/ }).click();
    await expect(page).toHaveURL("/north-star");
    await expect(page.getByText("Next milestone: below 90%")).toBeVisible();
    await expect(page.getByText(/Scenario:/)).toHaveCount(0);
  });

  test("Reset · Live returns the dial and metrics to the actual current position", async ({ page }) => {
    await login(page);
    await page.goto("/north-star");
    await dragDialTo(page, 30);
    await expect(page.getByText("Scenario: 30% dependency")).toBeVisible();

    await page.getByRole("button", { name: "Reset · Live" }).click();

    await expect(page.getByText("Next milestone: below 90%")).toBeVisible();
    await expect(page.getByText("sustainable, per year")).toBeVisible();
    await expect(page.getByText("lower is more independent")).toBeVisible();
    await expect(page.getByRole("button", { name: "Reset · Live" })).toHaveCount(0);
  });

  test("no scenario value is persisted as a household assumption", async ({ page }) => {
    await login(page);
    await page.goto("/north-star");
    await dragDialTo(page, 30);
    await expect(page.getByText("Scenario: 30% dependency")).toBeVisible();

    // A fresh server request (not just client navigation) must still show
    // the household's real stored target — never the abandoned scenario.
    await page.reload();
    await scrollToPanel2(page);
    const directionPair = page.locator("h3", { hasText: "Direction" }).locator("..").locator("div.grid").first();
    await expect(directionPair.getByRole("button", { name: /Target dependency/ })).toContainText("0%");
  });
});

test.describe("North Star tile pairs (compact control panel redesign)", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  // "Other engines" — Side income (left) | Other passive (right).
  function otherEnginesPair(page: Page) {
    return page.locator("h3", { hasText: "Other engines" }).locator("..").locator("div.grid").first();
  }

  test("tapping the left tile in a pair expands it across both columns and hides the right tile", async ({ page }) => {
    await login(page);
    await page.goto("/north-star");
    await scrollToPanel2(page);

    const pair = otherEnginesPair(page);
    await expect(pair.getByRole("button", { name: /Side income/ })).toBeVisible();
    await expect(pair.getByRole("button", { name: /Other passive/ })).toBeVisible();

    await pair.getByRole("button", { name: /Side income/ }).click();

    // The expanded card shows the full title/description/editor...
    await expect(page.getByText("Side business / hustle income")).toBeVisible();
    await expect(page.getByText("After tax and associated costs.")).toBeVisible();
    // ...and the partner tile is gone while it's open.
    await expect(pair.getByRole("button", { name: /Other passive/ })).toHaveCount(0);
  });

  test("tapping the right tile in a pair expands it across both columns and hides the left tile", async ({ page }) => {
    await login(page);
    await page.goto("/north-star");
    await scrollToPanel2(page);

    const pair = otherEnginesPair(page);
    await pair.getByRole("button", { name: /Other passive/ }).click();

    await expect(page.getByText("Other passive income")).toBeVisible();
    await expect(pair.getByRole("button", { name: /Side income/ })).toHaveCount(0);
  });

  test("closing an expanded tile restores the exact original pair", async ({ page }) => {
    await login(page);
    await page.goto("/north-star");
    await scrollToPanel2(page);

    const pair = otherEnginesPair(page);
    await pair.getByRole("button", { name: /Side income/ }).click();
    await expect(page.getByText("Side business / hustle income")).toBeVisible();

    await page.getByRole("button", { name: "Done" }).click();

    await expect(pair.getByRole("button", { name: /Side income/ })).toBeVisible();
    await expect(pair.getByRole("button", { name: /Other passive/ })).toBeVisible();
    await expect(page.getByText("Side business / hustle income")).toHaveCount(0);
  });

  test("editing an assumption on Page 2 persists across reload", async ({ page }) => {
    await login(page);
    await page.goto("/north-star");
    await scrollToPanel2(page);

    const pair = otherEnginesPair(page);
    await pair.getByRole("button", { name: /Side income/ }).click();
    await page.locator('input[type="number"]').fill("5000");
    await page.getByRole("button", { name: "Save" }).click();

    await expect(pair.getByRole("button", { name: /Side income/ })).toContainText("$5k");

    await page.reload();
    await scrollToPanel2(page);
    await expect(otherEnginesPair(page).getByRole("button", { name: /Side income/ })).toContainText("$5k");

    // Restore the seed value so the demo household is left as re-runnable.
    await otherEnginesPair(page)
      .getByRole("button", { name: /Side income/ })
      .click();
    await page.locator('input[type="number"]').fill("0");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(otherEnginesPair(page).getByRole("button", { name: /Side income/ })).toContainText("$0.00");
  });

  test("the calculated Available surplus responds to a change in Employment income", async ({ page }) => {
    await login(page);
    await page.goto("/north-star");
    await scrollToPanel2(page);

    await expect(page.getByText("$30,000.00 p.a.")).toBeVisible();

    const ourLifePair = page.locator("h3", { hasText: "Our life" }).locator("..").locator("div.grid").first();
    await ourLifePair.getByRole("button", { name: /Employment/ }).click();
    await page.locator('input[type="number"]').fill("230000");
    await page.getByRole("button", { name: "Save" }).click();

    await expect(page.getByText("$40,000.00 p.a.")).toBeVisible();

    // Restore the seed value.
    await ourLifePair.getByRole("button", { name: /Employment/ }).click();
    await page.locator('input[type="number"]').fill("220000");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("$30,000.00 p.a.")).toBeVisible();
  });
});
