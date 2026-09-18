import { randomUUID } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
import { prisma } from "@frodocodo/db";

/**
 * Security audit findings C1 (Plan allocation cross-household write IDOR)
 * and H1 (categoryId ownership gap in reclassify/commitments + its
 * extension into budgetSnapshot.ts's uncovered-category pass). Every test
 * fabricates a genuinely separate "Household B" via Prisma directly (never
 * reachable through the seeded demo household's own UI) and then attempts
 * to reach across into it from the seeded demo admin's own session by
 * tampering with client-controlled form values exactly the way the audit
 * described — a hidden input's value, an injected <option>, or an
 * appended form field — rather than asserting against the helper
 * functions in isolation. Cleanup runs in afterAll/finally so a failure
 * doesn't leave stray rows in this single shared dev DB (playwright.config.ts:
 * fullyParallel: false, workers: 1).
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

async function getHouseholdAContext() {
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: ADMIN_EMAIL }, include: { memberships: true } });
  const householdId = admin.memberships[0]!.householdId;
  const account = await prisma.account.findFirstOrThrow({ where: { connection: { householdId } } });
  return { householdId, accountId: account.id };
}

test.describe("Household isolation (security audit findings C1 & H1)", () => {
  let householdBId: string;
  let householdBCategoryId: string;
  let householdBBudgetPeriodId: string;
  let householdBCategoryName: string;
  const householdBAllocationAmount = 500;

  test.beforeAll(async () => {
    const suffix = randomUUID().slice(0, 8);
    householdBCategoryName = `E2E Household B Category ${suffix}`;

    const household = await prisma.household.create({ data: { name: `E2E Household B ${suffix}` } });
    const bucket = await prisma.budgetBucket.create({
      data: { householdId: household.id, name: `E2E Household B Bucket ${suffix}`, colorToken: "neutral" },
    });
    const category = await prisma.category.create({
      data: { householdId: household.id, bucketId: bucket.id, name: householdBCategoryName, spendingType: "FLEXIBLE" },
    });
    const period = await prisma.budgetPeriod.create({
      data: {
        householdId: household.id,
        type: "CALENDAR_MONTH",
        startDate: new Date("2020-01-01"),
        endDate: new Date("2020-01-31"),
        allocations: { create: [{ categoryId: category.id, amount: householdBAllocationAmount }] },
      },
    });

    householdBId = household.id;
    householdBCategoryId = category.id;
    householdBBudgetPeriodId = period.id;
  });

  test.afterAll(async () => {
    await prisma.household.delete({ where: { id: householdBId } }); // cascades bucket/category/period/allocations
  });

  test("C1: an admin can update their own household's allocations", async ({ page }) => {
    const category = await prisma.category.findFirstOrThrow({ where: { name: "Fuel" } });

    await login(page);
    await page.goto("/plan");
    // The current budget period auto-rolls over month to month
    // (ensureBudgetPeriod) — older periods keep their own
    // BudgetAllocation rows for the same category, so the *current* one
    // (whatever the page actually rendered into the hidden field) is the
    // one this update targets, not just any row matching this categoryId.
    const currentBudgetPeriodId = await page.locator('input[name="budgetPeriodId"]').inputValue();
    const before = await prisma.budgetAllocation.findFirstOrThrow({ where: { categoryId: category.id, budgetPeriodId: currentBudgetPeriodId } });

    const input = page.locator(`input[name="allocation:${category.id}"]`);
    await expect(input).toBeVisible();
    await input.fill("777");
    await page.getByRole("button", { name: "Save budget" }).click();

    try {
      // The Plan page's own URL never changes on save (no redirect in
      // updateAllocations) and nothing in the UI signals completion, so
      // polling the DB — rather than a single immediate read racing the
      // in-flight server action — is what actually waits for the mutation
      // to land instead of assuming a same-tick response.
      await expect
        .poll(async () => {
          const refreshed = await prisma.budgetAllocation.findFirstOrThrow({ where: { categoryId: category.id, budgetPeriodId: currentBudgetPeriodId } });
          return refreshed.amount.toNumber();
        })
        .toBe(777);
    } finally {
      await prisma.budgetAllocation.update({ where: { id: before.id }, data: { amount: before.amount } });
    }
  });

  test("C1: an admin cannot mutate another household's budget period by tampering the hidden budgetPeriodId field", async ({ page }) => {
    await login(page);
    await page.goto("/plan");
    await page
      .locator('input[name="budgetPeriodId"]')
      .evaluate((el, value) => {
        (el as HTMLInputElement).value = value;
      }, householdBBudgetPeriodId);
    await page.getByRole("button", { name: "Save budget" }).click();

    // Household B's own allocation is completely untouched, regardless of
    // what happened to the (now-mismatched) allocation:<categoryId> field
    // names still on the page from household A's own render.
    const allocation = await prisma.budgetAllocation.findFirstOrThrow({
      where: { budgetPeriodId: householdBBudgetPeriodId, categoryId: householdBCategoryId },
    });
    expect(allocation.amount.toNumber()).toBe(householdBAllocationAmount);
  });

  test("C1: an admin cannot inject another household's category into their own allocation update", async ({ page }) => {
    const groceries = await prisma.category.findFirstOrThrow({ where: { name: "Groceries" } });
    const before = await prisma.budgetAllocation.findFirstOrThrow({ where: { categoryId: groceries.id } });

    await login(page);
    await page.goto("/plan");
    await page.evaluate((categoryId) => {
      const form = document.querySelector("form");
      const input = document.createElement("input");
      input.type = "number";
      input.name = `allocation:${categoryId}`;
      input.value = "999";
      form?.appendChild(input);
    }, householdBCategoryId);
    await page.getByRole("button", { name: "Save budget" }).click();

    // Nothing was written for household B's category under any budget period...
    const injected = await prisma.budgetAllocation.findFirst({ where: { categoryId: householdBCategoryId, budgetPeriodId: { not: householdBBudgetPeriodId } } });
    expect(injected).toBeNull();
    // ...household B's real allocation is untouched...
    const real = await prisma.budgetAllocation.findFirstOrThrow({ where: { categoryId: householdBCategoryId, budgetPeriodId: householdBBudgetPeriodId } });
    expect(real.amount.toNumber()).toBe(householdBAllocationAmount);
    // ...and the whole update failed closed together — household A's own
    // legitimate allocation in that same submission was not partially applied either.
    const ownAllocation = await prisma.budgetAllocation.findFirstOrThrow({ where: { categoryId: groceries.id } });
    expect(ownAllocation.amount.toNumber()).toBe(before.amount.toNumber());
  });

  test("H1: reclassifying a transaction cannot be pointed at another household's category", async ({ page }) => {
    const { accountId } = await getHouseholdAContext();
    const tx = await prisma.transaction.create({
      data: { accountId, transactionDate: new Date(), amount: 12.34, direction: "DEBIT", status: "POSTED", originalDescription: "E2E isolation fixture" },
    });

    try {
      await login(page);
      await page.goto(`/transactions/${tx.id}`);
      const select = page.locator('select[name="categoryId"]');
      await select.evaluate((el, categoryId) => {
        const option = document.createElement("option");
        option.value = categoryId;
        option.textContent = "Injected Foreign Category";
        el.appendChild(option);
      }, householdBCategoryId);
      await select.selectOption(householdBCategoryId);
      await page.getByRole("button", { name: "Save", exact: true }).click();

      // No success confirmation, and the transaction stays uncategorised —
      // never actually classified under the foreign category.
      await expect(page.getByText("Classified by")).toHaveCount(0);
      const refreshed = await prisma.transaction.findUniqueOrThrow({ where: { id: tx.id } });
      expect(refreshed.categoryId).toBeNull();
      const classification = await prisma.transactionClassification.findFirst({ where: { transactionId: tx.id, categoryId: householdBCategoryId } });
      expect(classification).toBeNull();
    } finally {
      await prisma.transaction.delete({ where: { id: tx.id } });
    }
  });

  test("H1: adding a commitment cannot be pointed at another household's category", async ({ page }) => {
    const name = `E2E Isolation Add ${randomUUID().slice(0, 8)}`;
    try {
      await login(page);
      await page.goto("/commitments");
      await page.getByText("+ Add a commitment").click();
      await page.getByLabel("Name").fill(name);
      await page.getByLabel("Amount").fill("42");
      await page.getByLabel("Expected date").fill(new Date().toISOString().slice(0, 10));

      const categorySelect = page.getByLabel("Category");
      await categorySelect.evaluate((el, categoryId) => {
        const option = document.createElement("option");
        option.value = categoryId;
        option.textContent = "Injected Foreign Category";
        el.appendChild(option);
      }, householdBCategoryId);
      await categorySelect.selectOption(householdBCategoryId);
      await page.getByRole("button", { name: "Add commitment" }).click();
      await expect(page.getByText("+ Add a commitment")).toBeVisible();

      const created = await prisma.upcomingCommitment.findFirst({ where: { name, categoryId: householdBCategoryId } });
      expect(created).toBeNull();
      const createdAtAll = await prisma.upcomingCommitment.findFirst({ where: { name } });
      expect(createdAtAll).toBeNull();
    } finally {
      await prisma.upcomingCommitment.deleteMany({ where: { name } });
    }
  });

  test("H1: updating a commitment cannot be pointed at another household's category", async ({ page }) => {
    const { householdId } = await getHouseholdAContext();
    const groceries = await prisma.category.findFirstOrThrow({ where: { householdId, name: "Groceries" } });
    const name = `E2E Isolation Update ${randomUUID().slice(0, 8)}`;
    const commitment = await prisma.upcomingCommitment.create({
      data: { householdId, categoryId: groceries.id, name, amount: 55, expectedDate: new Date() },
    });

    try {
      await login(page);
      await page.goto("/commitments");
      await page.getByText(name, { exact: true }).first().click();

      const categorySelect = page.getByLabel("Category");
      await categorySelect.evaluate((el, categoryId) => {
        const option = document.createElement("option");
        option.value = categoryId;
        option.textContent = "Injected Foreign Category";
        el.appendChild(option);
      }, householdBCategoryId);
      await categorySelect.selectOption(householdBCategoryId);
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await page.waitForTimeout(300); // let the fire-and-forget action + router.refresh() land before reading the DB

      const refreshed = await prisma.upcomingCommitment.findUniqueOrThrow({ where: { id: commitment.id } });
      expect(refreshed.categoryId).toBe(groceries.id);
    } finally {
      await prisma.upcomingCommitment.delete({ where: { id: commitment.id } });
    }
  });

  test("H1 (defense in depth): a foreign categoryId on one of the household's own transactions never surfaces that household's real category/bucket name", async ({ page }) => {
    const { accountId } = await getHouseholdAContext();
    // Bypasses the action-layer ownership checks on purpose — this
    // specifically exercises budgetSnapshot.ts's own householdId filter on
    // the uncovered-category query, independent of whether the mutation
    // layer that would normally prevent this state is working.
    const tx = await prisma.transaction.create({
      data: {
        accountId,
        transactionDate: new Date(),
        amount: 99.99,
        direction: "DEBIT",
        status: "POSTED",
        originalDescription: "E2E poisoned-category fixture",
        categoryId: householdBCategoryId,
      },
    });

    try {
      await login(page);
      await page.goto("/");
      await page.locator("section").first().waitFor();
      await expect(page.getByText(householdBCategoryName)).toHaveCount(0);

      await page.goto("/plan");
      await expect(page.getByText(householdBCategoryName)).toHaveCount(0);
    } finally {
      await prisma.transaction.delete({ where: { id: tx.id } });
    }
  });
});
