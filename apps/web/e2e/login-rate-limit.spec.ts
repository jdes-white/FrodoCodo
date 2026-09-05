import { randomUUID } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
import { prisma } from "@frodocodo/db";

/**
 * Login rate limiting (apps/web/lib/loginRateLimit.ts, security audit
 * finding H2). The pure counting/threshold logic is unit-tested directly
 * against a mocked prisma in lib/__tests__/loginRateLimit.test.ts — these
 * tests instead drive the real /login form against the real dev DB, to
 * prove the wiring in login/actions.ts actually throttles real requests.
 *
 * "Recovery after the window" and "successful throttling" are proven by
 * fabricating LoginAttempt rows directly via Prisma with a chosen
 * `createdAt`, rather than waiting out the real 15-minute window — the
 * same fixture-injection style already used elsewhere in this suite (see
 * categorisation-reliability.spec.ts).
 *
 * Every test below uses an email that isn't a real seeded account —
 * password is always wrong, so no test here ever logs in successfully.
 * The identifier itself never appears in the DEMO admin/member accounts,
 * so these attempts can't affect real login ability elsewhere in the suite.
 */

const ADMIN_EMAIL = "admin@frodocodo.household";
const ADMIN_PASSWORD = "frodocodo-demo";

async function attemptLogin(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

async function cleanupIdentifier(identifier: string) {
  await prisma.loginAttempt.deleteMany({ where: { identifier } });
}

test.describe("Login rate limiting", () => {
  test("normal login: a correct email and password still succeeds", async ({ page }) => {
    await attemptLogin(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await expect(page).toHaveURL("/");
  });

  test("does not expose whether a supplied email is a valid account", async ({ page }) => {
    const fakeEmail = `e2e-nonexistent-${randomUUID().slice(0, 8)}@example.com`;
    try {
      await attemptLogin(page, fakeEmail, "wrong-password");
      const forFakeEmail = await page.getByText("That email or password isn't right.").textContent();

      await attemptLogin(page, ADMIN_EMAIL, "wrong-password");
      const forRealEmail = await page.getByText("That email or password isn't right.").textContent();

      expect(forFakeEmail).toBe(forRealEmail);
    } finally {
      await cleanupIdentifier(fakeEmail);
      await cleanupIdentifier(ADMIN_EMAIL);
    }
  });

  test("repeated failed attempts are throttled, and recover once the window passes", async ({ page }) => {
    const email = `e2e-throttle-${randomUUID().slice(0, 8)}@example.com`;
    try {
      // 5 failed attempts stay under the per-identifier threshold...
      for (let i = 0; i < 5; i++) {
        await attemptLogin(page, email, "wrong-password");
        await expect(page.getByText("That email or password isn't right.")).toBeVisible();
      }

      // ...the 6th is throttled.
      await attemptLogin(page, email, "wrong-password");
      await expect(page.getByText("Too many attempts. Please wait a few minutes and try again.")).toBeVisible();

      // Backdate every recorded failure for this identifier to outside the
      // 15-minute window, simulating "the window has passed" without
      // actually waiting 15 minutes.
      await prisma.loginAttempt.updateMany({
        where: { identifier: email },
        data: { createdAt: new Date(Date.now() - 20 * 60 * 1000) },
      });

      await attemptLogin(page, email, "wrong-password");
      await expect(page.getByText("That email or password isn't right.")).toBeVisible();
      await expect(page.getByText("Too many attempts. Please wait a few minutes and try again.")).toHaveCount(0);
    } finally {
      await cleanupIdentifier(email);
    }
  });

  test("different users do not incorrectly lock one another out", async ({ page }) => {
    const lockedOutEmail = `e2e-locked-${randomUUID().slice(0, 8)}@example.com`;
    const unaffectedEmail = `e2e-unaffected-${randomUUID().slice(0, 8)}@example.com`;
    try {
      // Fabricate 5 recent failures for one identifier only.
      await prisma.loginAttempt.createMany({
        data: Array.from({ length: 5 }, () => ({ identifier: lockedOutEmail, ipAddress: null, succeeded: false })),
      });

      await attemptLogin(page, lockedOutEmail, "wrong-password");
      await expect(page.getByText("Too many attempts. Please wait a few minutes and try again.")).toBeVisible();

      // A different identifier — never attempted before — is completely unaffected.
      await attemptLogin(page, unaffectedEmail, "wrong-password");
      await expect(page.getByText("That email or password isn't right.")).toBeVisible();
      await expect(page.getByText("Too many attempts. Please wait a few minutes and try again.")).toHaveCount(0);
    } finally {
      await cleanupIdentifier(lockedOutEmail);
      await cleanupIdentifier(unaffectedEmail);
    }
  });
});
