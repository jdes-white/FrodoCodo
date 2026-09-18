import { test, expect, type Page } from "@playwright/test";
import { prisma } from "@frodocodo/db";

/**
 * Task 7C — the live-connection flow, exercised end-to-end against
 * MockProvider (this suite's default, FINANCIAL_PROVIDER unset) — the
 * same server action / callback-route code path a real Basiq connection
 * would go through, except MockProvider has no hosted Consent UI to
 * redirect through (its consent is `ACTIVE` immediately — see
 * `MockProvider.initiateConnection`), so `connectInstitution` finishes
 * synchronously instead of redirecting to `/api/basiq/callback`. That
 * redirect-and-return half is real, tested code
 * (`packages/providers`'s `beginBasiqConsent`/`consentUi.ts`, and
 * `apps/web/lib/basiqConnectState.ts`'s signed-state verification) but
 * cannot be exercised end-to-end from this environment — see
 * docs/basiq-integration.md.
 *
 * Runs single-worker/sequential against the shared demo-seeded DB
 * (playwright.config.ts), so this test starts by disconnecting an
 * already-connected institution to create a "connectable" slot, rather
 * than assuming one exists.
 */

const ADMIN_EMAIL = "admin@frodocodo.household";
const ADMIN_PASSWORD = "frodocodo-demo";
const MEMBER_EMAIL = "member@frodocodo.household";
const MEMBER_PASSWORD = "frodocodo-demo";

async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL("/");
}

test("admin can reconnect a disconnected institution through the mock provider flow, and it syncs accounts + transactions", async ({ page }) => {
  const cbaConnection = await prisma.financialConnection.findFirstOrThrow({
    where: { isActive: true, institution: { providerInstitutionId: "cba" } },
    include: { institution: true },
  });
  const institutionName = cbaConnection.institution.name;

  await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  await page.goto("/settings");

  // Disconnect it first so there's a connectable slot for this flow to fill.
  const existingRow = page.getByTestId(`connection-${cbaConnection.id}`);
  await existingRow.getByRole("button", { name: "Disconnect" }).click();
  await expect(async () => {
    if ((await existingRow.getAttribute("data-connection-status")) !== "DISCONNECTED") await page.reload();
    await expect(existingRow).toHaveAttribute("data-connection-status", "DISCONNECTED");
  }).toPass({ timeout: 15_000 });

  await page.reload();
  const connectSection = page.getByRole("heading", { name: "Connect an institution" });
  await expect(connectSection).toBeVisible();
  const connectForm = page.locator("form", { has: page.getByText(institutionName) });
  await expect(connectForm.getByRole("button", { name: "Connect" })).toBeVisible();

  await connectForm.getByRole("button", { name: "Connect" }).click();
  await expect(page).toHaveURL(/\/settings\?connected=success/);
  await expect(page.getByText("Institution connected.")).toBeVisible();

  const newConnection = await prisma.financialConnection.findFirstOrThrow({
    where: { householdId: cbaConnection.householdId, institutionId: cbaConnection.institutionId, isActive: true },
    include: { accounts: true },
  });
  expect(newConnection.id).not.toBe(cbaConnection.id); // reconnecting creates a fresh connection, per existing disconnect/reconnect design
  expect(newConnection.consentStatus).toBe("ACTIVE");
  expect(newConnection.accounts.length).toBeGreaterThan(0);

  const transactionCount = await prisma.transaction.count({ where: { accountId: newConnection.accounts[0]!.id } });
  expect(transactionCount).toBeGreaterThan(0);
});

test("a non-admin member never sees the connect-an-institution controls", async ({ page }) => {
  // Disconnect Virgin as admin so a connectable slot genuinely exists —
  // proving the section is admin-gated, not merely absent because nothing
  // is connectable.
  const virginConnection = await prisma.financialConnection.findFirstOrThrow({
    where: { isActive: true, institution: { providerInstitutionId: "virgin-money-au" } },
  });
  await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  await page.goto("/settings");
  const row = page.getByTestId(`connection-${virginConnection.id}`);
  await row.getByRole("button", { name: "Disconnect" }).click();
  await expect(async () => {
    if ((await row.getAttribute("data-connection-status")) !== "DISCONNECTED") await page.reload();
    await expect(row).toHaveAttribute("data-connection-status", "DISCONNECTED");
  }).toPass({ timeout: 15_000 });

  await page.context().clearCookies();
  await login(page, MEMBER_EMAIL, MEMBER_PASSWORD);
  await page.goto("/settings");

  await expect(page.getByRole("heading", { name: "Connect an institution" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Connect" })).toHaveCount(0);
});
