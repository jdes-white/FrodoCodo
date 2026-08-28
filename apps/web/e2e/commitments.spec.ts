import { test, expect, type Page } from "@playwright/test";

/**
 * Upcoming Commitments V1 (§8 of the spec), plus the /commitments
 * management-page behavior from the later Home Page 2 bucket-card
 * integration (see e2e/home-commitment-buckets.spec.ts for that
 * integration's own Home-side coverage). Every test clears the
 * household's commitment list first, then builds exactly the data it
 * needs via the UI — these run single-worker/sequential against one
 * shared dev DB alongside every other spec file (playwright.config.ts:
 * fullyParallel: false, workers: 1), so starting from a known-empty
 * baseline makes each test's assertions ("only this commitment is
 * visible") correct regardless of run order or whatever the demo seed
 * currently contains.
 *
 * The household-wide "Coming Up" widget (committed/uncommitted totals,
 * shortfall warning) that used to live on Home was retired by the bucket-
 * card integration in favor of each bucket showing its own rolling 7-day
 * due line — see BucketCard.tsx / BucketDueLine.tsx. The underlying
 * committed/uncommitted arithmetic (`summarizeCommitments`,
 * `isCommitmentDueInPeriod`) still lives in packages/domain and stays
 * unit-tested there; it's just no longer rendered as a standalone widget.
 *
 * The precise arithmetic (§2's formula) is already covered exactly in
 * packages/domain/src/__tests__/commitments.test.ts against deterministic
 * inputs — these tests verify the real UI is wired to real DB state
 * correctly, not the formula itself.
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

function isoDate(daysFromNow: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysFromNow);
  return d.toISOString().slice(0, 10);
}

/**
 * Removes every commitment currently on the page (paid or not), leaving a
 * known-empty baseline. Assumes it starts on /commitments.
 *
 * Waits for the row *count* to actually drop after each removal, not just
 * for the edit form to collapse — the edit form's "Remove" button
 * disappears the instant local component state flips (CommitmentCard.tsx
 * sets `expanded = false` right after firing `router.refresh()`), which
 * can happen before that refresh's server round-trip has actually landed
 * and repainted the list. Proceeding to the next iteration on that signal
 * alone races the real data: the next `.first()` can grab a DOM node that
 * a delayed refresh then swaps out mid-click, surfacing as "element was
 * detached from the DOM" instead of a stable pass.
 */
async function clearAllCommitments(page: Page) {
  const rows = page.locator("main button").filter({ hasNotText: "+ Add a commitment" });
  for (let i = 0; i < 50; i++) {
    const countBefore = await rows.count();
    if (countBefore === 0) break;
    await rows.first().click();
    await page.getByRole("button", { name: "Remove" }).click();
    await expect(rows).toHaveCount(countBefore - 1);
  }
}

async function addCommitment(
  page: Page,
  { name, amount, days, recurrence, category }: { name: string; amount: string; days: number; recurrence?: string; category?: string },
) {
  await page.getByText("+ Add a commitment").click();
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Amount").fill(amount);
  await page.getByLabel("Expected date").fill(isoDate(days));
  if (recurrence) await page.getByLabel("Repeats").selectOption(recurrence);
  await page.getByLabel("Category").selectOption({ label: category ?? "Groceries" });
  await page.getByRole("button", { name: "Add commitment" }).click();
  // Wait for the actual server-refreshed list to show the new row, not
  // just for the add form to collapse — see clearAllCommitments's doc
  // comment for why the two can be out of sync.
  await expect(page.getByText(name, { exact: true })).toBeVisible();
  await expect(page.getByText("+ Add a commitment")).toBeVisible();
}

test.describe("Upcoming Commitments V1", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await page.goto("/commitments");
    await clearAllCommitments(page);
  });

  test("adding, editing, and removing a commitment", async ({ page }) => {
    await addCommitment(page, { name: "E2E Test Bill", amount: "250", days: 2 });
    await expect(page.getByText("E2E Test Bill", { exact: true })).toBeVisible();
    await expect(page.getByText("$250.00").first()).toBeVisible();

    await page.getByText("E2E Test Bill", { exact: true }).first().click();
    await page.getByLabel("Name").fill("E2E Test Bill (renamed)");
    await page.getByLabel("Amount").fill("275");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("E2E Test Bill (renamed)", { exact: true })).toBeVisible();
    await expect(page.getByText("$275.00").first()).toBeVisible();
    await expect(page.getByText("E2E Test Bill", { exact: true })).toHaveCount(0);

    await page.getByText("E2E Test Bill (renamed)", { exact: true }).first().click();
    await page.getByRole("button", { name: "Remove" }).click();
    await expect(page.getByText("E2E Test Bill (renamed)", { exact: true })).toHaveCount(0);
  });

  test("marking a commitment paid moves it to Paid and it stops appearing on Home's bucket due line", async ({ page }) => {
    await addCommitment(page, { name: "E2E Paid Test", amount: "88", days: 1, category: "Groceries" });

    await page.goto("/");
    await page.locator("section").first().waitFor();
    await expect(page.getByText("$88.00 due tomorrow", { exact: true })).toBeVisible();

    await page.goto("/commitments");
    await page.getByText("E2E Paid Test", { exact: true }).first().click();
    await page.getByRole("button", { name: "Mark paid" }).click();
    // The row collapses and the list re-renders from a client-side
    // router.refresh() — same fire-and-forget-then-refresh pattern as
    // North Star's TilePair.tsx (apps/web/components/TilePair.tsx),
    // which is a known source of an occasional client-side timing race
    // (see that component's doc comment / CLAUDE.md session history).
    // Reloading verifies the actually-persisted outcome rather than
    // racing the optimistic client transition, matching how
    // north-star.spec.ts's "persists across reload" test does the same.
    await page.reload();

    await expect(page.getByText("Paid", { exact: true })).toBeVisible();
    await expect(page.getByText("E2E Paid Test", { exact: true })).toBeVisible();
    await expect(page.getByText(/^Paid ·/)).toBeVisible();

    // Once completed, it's the household's only commitment, so no bucket
    // on Home shows a due line anymore.
    await page.goto("/");
    await page.locator("section").first().waitFor();
    await expect(page.getByText("$88.00 due tomorrow", { exact: true })).toHaveCount(0);

    await page.goto("/commitments");
    await page.getByText("E2E Paid Test", { exact: true }).first().click();
    await expect(page.getByRole("button", { name: "Mark paid" })).toHaveCount(0); // already paid — no re-showing the action
    await page.getByRole("button", { name: "Remove" }).click();
  });

  test("both household users see and can maintain the same commitments", async ({ page }) => {
    await addCommitment(page, { name: "E2E Shared Bill", amount: "42", days: 3 });

    // Sign out is a server-action form submit that redirects to /login —
    // wait for that navigation to actually land before logging back in as
    // the other user, otherwise login()'s own page.goto("/login") can race
    // the in-flight redirect and hit the still-authenticated page instead.
    await page.getByRole("button", { name: "Sign out" }).click();
    await page.waitForURL("**/login");
    await login(page, MEMBER_EMAIL, MEMBER_PASSWORD);
    await page.goto("/commitments");
    await expect(page.getByText("E2E Shared Bill", { exact: true })).toBeVisible();

    await page.getByText("E2E Shared Bill", { exact: true }).first().click();
    await page.getByRole("button", { name: "Mark paid" }).click();
    await page.reload(); // verify the persisted outcome, not the optimistic client transition — see the other mark-paid test's comment
    await expect(page.getByText(/^Paid ·/)).toBeVisible();
  });

  test("a household with zero commitments still has a permanent entry point into /commitments from Home, and a plain empty state on the commitments page itself", async ({
    page,
  }) => {
    await expect(page.getByText(/No upcoming commitments yet/)).toBeVisible();

    await page.goto("/");
    await page.locator("section").first().waitFor();
    // The "View all upcoming commitments" link is always rendered on Home
    // Page 2, regardless of whether any bucket has anything due — it's the
    // household's permanent, discoverable entry point into /commitments
    // (see ViewAllCommitmentsLink.tsx), unlike a per-bucket due line which
    // only appears when that bucket actually has something coming up.
    await expect(page.getByText("View all upcoming commitments", { exact: true })).toBeVisible();
    // With nothing due anywhere, no bucket shows a due line at all.
    await expect(page.getByText(/due (today|tomorrow|in )/)).toHaveCount(0);

    await page.getByText("View all upcoming commitments", { exact: true }).click();
    await expect(page).toHaveURL("/commitments");
  });
});
