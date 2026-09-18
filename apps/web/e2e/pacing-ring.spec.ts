import { test, expect, type Page, type Browser } from "@playwright/test";

/**
 * Home Page 1's dual-arc pacing ring (components/PacingRing.tsx). The
 * exact numeric scenarios from the brief (70/40 -> dark green, etc.) are
 * covered deterministically at the domain layer
 * (packages/domain/src/__tests__/pacePosition.test.ts) — this suite
 * verifies the *rendering*: the redundant caption is gone, the two arcs
 * and the marker are internally consistent with each other, and colour
 * actually resolves (differently) in both themes. Mobile snap/one-screen
 * fit is covered by the unmodified e2e/home-panels.spec.ts, which this
 * batch re-ran and confirmed still passes.
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

test.describe("Home pacing ring", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("the redundant 'X% through the period · Y% used' caption is gone", async ({ page }) => {
    await login(page);
    await expect(page.getByText(/through the period/)).toHaveCount(0);
    // The information it used to carry is still present some other way —
    // this isn't just a deleted sentence with nothing replacing it.
    await expect(page.locator("svg circle").first()).toBeVisible();
  });

  test("renders a thick actual-spend arc, a thin expected-position arc, and an endpoint marker, self-consistently positioned", async ({ page }) => {
    await login(page);

    const geometry = await page.evaluate(() => {
      const circles = Array.from(document.querySelectorAll("svg circle"));
      // Order matches PacingRing.tsx's render order: [thick track, thin
      // track, thin arc, marker dot, thick arc].
      const thinArc = circles[2];
      const marker = circles[3];
      const thickArc = circles[4];
      if (!thinArc || !marker || !thickArc) return null;

      const r = Number(thinArc.getAttribute("r"));
      const circumference = Number(thinArc.getAttribute("stroke-dasharray"));
      const offset = Number(thinArc.getAttribute("stroke-dashoffset"));
      const expectedPercentFromArc = (1 - offset / circumference) * 100;

      const cx = Number(thinArc.getAttribute("cx"));
      const cy = Number(thinArc.getAttribute("cy"));
      const angle = (expectedPercentFromArc / 100) * 2 * Math.PI;
      const predictedMarkerX = cx + r * Math.cos(angle);
      const predictedMarkerY = cy + r * Math.sin(angle);

      return {
        thickStroke: thickArc.getAttribute("stroke"),
        thickOffset: Number(thickArc.getAttribute("stroke-dashoffset")),
        markerX: Number(marker.getAttribute("cx")),
        markerY: Number(marker.getAttribute("cy")),
        predictedMarkerX,
        predictedMarkerY,
      };
    });

    expect(geometry).not.toBeNull();
    // The marker sits exactly where the thin arc's own fill fraction implies.
    expect(geometry!.markerX).toBeCloseTo(geometry!.predictedMarkerX, 5);
    expect(geometry!.markerY).toBeCloseTo(geometry!.predictedMarkerY, 5);
    // The thick arc's fill is a real, bounded value — never negative
    // (which would indicate an unclamped overspend wrapping the arc).
    expect(geometry!.thickOffset).toBeGreaterThanOrEqual(0);
    // Colour comes from the continuous pace gradient (a CSS var or a color-mix() blend of two).
    expect(geometry!.thickStroke).toMatch(/^(var\(--pace-|color-mix\()/);
  });

  test("the arc colour resolves to an actual (different) colour in light vs dark mode", async ({ browser }) => {
    const lightColor = await readResolvedArcColor(browser, "light");
    const darkColor = await readResolvedArcColor(browser, "dark");

    // Chromium resolves a color-mix() result as e.g. "color(srgb 0.06 0.48 0.28)"
    // rather than "rgb(...)" — either is a genuinely resolved color, not
    // an unresolved var()/color-mix() string or empty value.
    expect(lightColor).toMatch(/^(rgb|color)\(/);
    expect(darkColor).toMatch(/^(rgb|color)\(/);
    expect(lightColor).not.toBe(darkColor);
  });
});

// Each call needs its own isolated browser context — reusing one `page`
// across both color schemes would leave it already authenticated on the
// second call, so navigating back to /login just redirects straight to
// Home instead of showing the form again.
async function readResolvedArcColor(browser: Browser, scheme: "light" | "dark"): Promise<string> {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: scheme });
  const page = await context.newPage();
  await login(page);
  const color = await page.evaluate(() => {
    const circles = Array.from(document.querySelectorAll("svg circle"));
    const thickArc = circles[4];
    return thickArc ? getComputedStyle(thickArc).stroke : null;
  });
  await context.close();
  expect(color).not.toBeNull();
  return color!;
}
