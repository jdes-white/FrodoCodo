import { test, expect } from "@playwright/test";
import { prisma } from "@frodocodo/db";

/**
 * Task 7A item 10 (disconnect/revocation): proves the real, deployed
 * disconnect action — not just a unit test of the mapping logic —
 * calls the provider's disconnectConnection, clears any stored token,
 * marks the connection revoked/inactive, and preserves the account and
 * its historical transactions. Runs against MockProvider
 * (FINANCIAL_PROVIDER=mock, this suite's default) — the same server
 * action path a real Basiq adapter would go through
 * (packages/providers/src/factory.ts), never a live Basiq call.
 */

const ADMIN_EMAIL = "admin@frodocodo.household";
const ADMIN_PASSWORD = "frodocodo-demo";

test("disconnecting an institution revokes it, clears any token, and preserves historical data", async ({ page }) => {
  const connectionBefore = await prisma.financialConnection.findFirstOrThrow({
    where: { isActive: true },
    include: { accounts: { include: { transactions: { take: 1 } } } },
  });
  const accountId = connectionBefore.accounts[0]!.id;
  const transactionCountBefore = await prisma.transaction.count({ where: { accountId } });
  expect(transactionCountBefore).toBeGreaterThan(0);

  await page.goto("/login");
  await page.getByLabel("Email").fill(ADMIN_EMAIL);
  await page.getByLabel("Password").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL("/");

  await page.goto("/settings");
  // Identify the exact same connection by its id (data-testid), never by
  // rendered order -- Postgres gives no ordering guarantee without an
  // explicit ORDER BY, and this query and the Settings page's own query
  // are independent.
  const row = page.getByTestId(`connection-${connectionBefore.id}`);
  const disconnectButton = row.getByRole("button", { name: "Disconnect" });
  await expect(row).toHaveAttribute("data-connection-status", "ACTIVE");
  await expect(disconnectButton).toBeEnabled();
  await disconnectButton.click();
  await page.waitForLoadState("networkidle");

  await expect(async () => {
    if ((await row.getAttribute("data-connection-status")) !== "DISCONNECTED") {
      await page.reload();
    }
    await expect(row).toHaveAttribute("data-connection-status", "DISCONNECTED");
  }).toPass({ timeout: 15_000 });
  await expect(row.getByText("disconnected")).toBeVisible();

  const connectionAfter = await prisma.financialConnection.findUniqueOrThrow({ where: { id: connectionBefore.id } });
  expect(connectionAfter.isActive).toBe(false);
  expect(connectionAfter.consentStatus).toBe("REVOKED");
  expect(connectionAfter.accessTokenEncrypted).toBeNull();
  expect(connectionAfter.refreshTokenEncrypted).toBeNull();

  // Historical data is preserved -- disconnecting is not deletion.
  const accountAfter = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
  expect(accountAfter).not.toBeNull();
  const transactionCountAfter = await prisma.transaction.count({ where: { accountId } });
  expect(transactionCountAfter).toBe(transactionCountBefore);
});
