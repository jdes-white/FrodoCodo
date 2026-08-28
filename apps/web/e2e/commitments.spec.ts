import { test, expect, type Page } from "@playwright/test";

/**
 * Upcoming Commitments V1 (§8 of the spec). Every test clears the
 * household's commitment list first, then builds exactly the data it
 * needs via the UI — these run single-worker/sequential against one
 * shared dev DB alongside every other spec file (playwright.config.ts:
 * fullyParallel: false, workers: 1), so starting from a known-empty
 * baseline makes each test's assertions (exact committed/uncommitted
 * totals, "only this commitment is visible") correct regardless of run
 * order or whatever the demo seed currently contains.
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

function parseAUD(text: string): number {
  return Number(text.replace(/[^0-9.-]/g, ""));
}

/** Removes every commitment currently on the page (paid or not), leaving a known-empty baseline. Assumes it starts on /commitments. */
async function clearAllCommitments(page: Page) {
  for (let i = 0; i < 50; i++) {
    const row = page.locator("main button").filter({ hasNotText: "+ Add a commitment" }).first();
    if ((await row.count()) === 0) break;
    await row.click();
    await page.getByRole("button", { name: "Remove" }).click();
    await expect(page.getByRole("button", { name: "Remove" })).toHaveCount(0);
  }
}

async function addCommitment(page: Page, { name, amount, days, recurrence }: { name: string; amount: string; days: number; recurrence?: string }) {
  await page.getByText("+ Add a commitment").click();
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Amount").fill(amount);
  await page.getByLabel("Expected date").fill(isoDate(days));
  if (recurrence) await page.getByLabel("Repeats").selectOption(recurrence);
  await page.getByRole("button", { name: "Add commitment" }).click();
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

  test("marking a commitment paid moves it to Paid and it stops counting toward Home's committed total", async ({ page }) => {
    await addCommitment(page, { name: "E2E Paid Test", amount: "88", days: 1 });

    await page.goto("/");
    await page.locator("section").first().waitFor();
    await expect(page.getByText("Coming up", { exact: true })).toBeVisible();
    await expect(page.getByText("$88.00").first()).toBeVisible();

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

    // Once completed, it's the household's only commitment, so it stops
    // counting and Home falls back to the "nothing due" prompt (§4) — the
    // Coming Up slot itself stays visible either way (see ComingUpCard.tsx's
    // doc comment: it's never omitted, so /commitments always has an entry
    // point from Home).
    await page.goto("/");
    await page.locator("section").first().waitFor();
    await expect(page.getByText(/No bills tracked/)).toBeVisible();

    await page.goto("/commitments");
    await page.getByText("E2E Paid Test", { exact: true }).first().click();
    await expect(page.getByRole("button", { name: "Mark paid" })).toHaveCount(0); // already paid — no re-showing the action
    await page.getByRole("button", { name: "Remove" }).click();
  });

  test("only commitments due within the current budget period count, with correct committed and uncommitted totals", async ({ page }) => {
    await page.goto("/");
    await page.locator("section").first().waitFor();
    const remainingBefore = parseAUD((await page.getByText("remaining of").locator("..").locator("p").first().textContent()) ?? "");

    await page.goto("/commitments");
    await addCommitment(page, { name: "E2E In-Period Bill", amount: "111.50", days: 2 });
    await addCommitment(page, { name: "E2E Future Bill", amount: "999", days: 200 }); // next budget period — must not count

    await page.goto("/");
    await page.locator("section").first().waitFor();

    const comingUp = page.getByText("Coming up", { exact: true }).locator("../..");
    await expect(comingUp).toBeVisible();
    await expect(comingUp).toContainText("E2E In-Period Bill");
    await expect(comingUp).not.toContainText("E2E Future Bill");

    const committed = parseAUD((await page.getByText("Committed", { exact: true }).locator("..").locator("p").nth(1).textContent()) ?? "");
    const uncommitted = parseAUD((await page.getByText("Uncommitted", { exact: true }).locator("..").locator("p").nth(1).textContent()) ?? "");
    expect(committed).toBeCloseTo(111.5, 2);
    expect(uncommitted).toBeCloseTo(remainingBefore - 111.5, 2);
  });

  test("shows a clear shortfall when commitments due this period exceed what's remaining", async ({ page }) => {
    // An amount far larger than any plausible remaining budget guarantees
    // a shortfall regardless of the demo household's current spend state.
    await addCommitment(page, { name: "E2E Huge Bill", amount: "500000", days: 1 });

    await page.goto("/");
    await page.locator("section").first().waitFor();

    await expect(page.getByText("Shortfall", { exact: true })).toBeVisible();
    await expect(page.getByText(/short$/)).toBeVisible();
    // The product spec explicitly avoids this phrase.
    await expect(page.getByText(/safe to spend/i)).toHaveCount(0);
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

  test("a household with zero commitments sees a compact 'add one' prompt on Home instead of the full Coming Up card, and a plain empty state on the commitments page", async ({
    page,
  }) => {
    await expect(page.getByText(/No upcoming commitments yet/)).toBeVisible();

    await page.goto("/");
    await page.locator("section").first().waitFor();
    // The Coming Up slot itself is never omitted (§ obvious entry point from
    // Home) — with nothing due it shows a tappable "add one" prompt rather
    // than the full item-list/committed-total card.
    await expect(page.getByText("Coming up", { exact: true })).toBeVisible();
    await expect(page.getByText(/No bills tracked/)).toBeVisible();
    await expect(page.getByText("Committed", { exact: true })).toHaveCount(0);

    await page.getByText(/No bills tracked/).click();
    await expect(page).toHaveURL("/commitments");
  });
});
