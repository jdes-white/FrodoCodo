import { test, expect, type Page } from "@playwright/test";
import { prisma } from "@frodocodo/db";
import { TEST_FIXTURE_MARKER, type ScreenshotExtractionResult } from "@frodocodo/ai";

/**
 * Batch screenshot transaction import, exercised end-to-end against the
 * real deployed app — the running dev server has no AI_PROVIDER=anthropic
 * configured in this suite, so `getScreenshotVisionExtractor()`
 * (apps/web/lib/screenshotExtractorFactory.ts) resolves to the stub
 * extractor (`packages/ai/src/screenshotExtraction.ts`), which replays a
 * `TEST_FIXTURE_MARKER`-prefixed JSON payload through the exact same
 * validation/normalization path a real Anthropic response would go
 * through. This proves the real upload -> extraction -> account
 * resolution -> dedupe -> classification -> reconciliation -> summary
 * pipeline, with only the vision call itself faked — the same relationship
 * MockProvider has to BasiqProvider.
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

// Every description below carries this run-unique tag so re-running this
// spec (locally, without reseeding between runs) never collides with a
// previous run's leftover rows — descriptions still match each other
// correctly within one run, since every fixture in a test shares the same
// RUN_ID.
const RUN_ID = Math.random().toString(36).slice(2, 8).toUpperCase();

function fixture(name: string, result: ScreenshotExtractionResult) {
  return { name, mimeType: "image/png", buffer: Buffer.from(TEST_FIXTURE_MARKER + JSON.stringify(result), "utf8") };
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

async function uploadScreenshots(page: Page, files: ReturnType<typeof fixture>[]) {
  await page.goto("/import");
  await page.locator('input[name="screenshots"]').setInputFiles(files);
  await page.getByRole("button", { name: "Upload and process" }).click();
  await expect(page.getByText(/screenshot(s)? processed/)).toBeVisible({ timeout: 15_000 });
}

test.describe("Batch screenshot import", () => {
  test("processes a mixed-source, randomly-ordered, overlapping batch correctly in one pass", async ({ page }) => {
    const cbaColes = { date: daysAgo(3), description: `COLES 0092 EVERTON PARK ${RUN_ID}`, amount: "45.30", direction: "DEBIT" as const, status: "POSTED" as const, confidence: 0.95 };
    const cbaSalary = { date: daysAgo(2), description: `Salary Dept of Industry ${RUN_ID}`, amount: "3162.81", direction: "CREDIT" as const, status: "POSTED" as const, confidence: 0.95 };
    const virginPending = { date: daysAgo(4), description: `APPLE.COM/BILL SYDNEY ${RUN_ID}`, amount: "22.00", direction: "DEBIT" as const, status: "PENDING" as const, confidence: 0.9 };
    const virginPosted = { date: daysAgo(2), description: `APPLE.COM/BILL SYDNEY ${RUN_ID}`, amount: "22.00", direction: "DEBIT" as const, status: "POSTED" as const, confidence: 0.9 };
    const amexCredit = { date: daysAgo(1), description: `COLES BROOKSIDE - 4430 MICHELTON ${RUN_ID}`, amount: "250.60", direction: "CREDIT" as const, status: "POSTED" as const, confidence: 0.9 };
    const reviewA = { date: daysAgo(5), description: `COLES 0092 EVERTON PARK AU ${RUN_ID}`, amount: "12.00", direction: "DEBIT" as const, status: "POSTED" as const, confidence: 0.9 };
    const reviewB = { date: daysAgo(5), description: `COLES 0092 EVERTON PARK QLD ${RUN_ID}`, amount: "12.00", direction: "DEBIT" as const, status: "POSTED" as const, confidence: 0.9 };

    // Deliberately unsorted by source, and the same real-world transaction
    // (cbaColes / the Apple.com charge) deliberately appears in more than
    // one "screenshot" here to model overlap.
    const files = [
      fixture("amex.png", { source: "AMEX", accountHint: "Velocity Platinum", transactions: [amexCredit] }),
      fixture("cba-overlap.png", { source: "CBA", accountHint: "Everyday Offset", transactions: [cbaColes] }),
      fixture("unreadable.png", { source: "UNKNOWN", accountHint: null, transactions: [] }),
      fixture("virgin-posted.png", { source: "VIRGIN_MONEY", accountHint: "Velocity High Flyer Card", transactions: [virginPosted] }),
      fixture("cba-main.png", { source: "CBA", accountHint: "Everyday Offset", transactions: [cbaColes, cbaSalary] }),
      fixture("review-b.png", { source: "CBA", accountHint: "Everyday Offset", transactions: [reviewB] }),
      fixture("virgin-pending.png", { source: "VIRGIN_MONEY", accountHint: "Velocity High Flyer Card", transactions: [virginPending] }),
      fixture("review-a.png", { source: "CBA", accountHint: "Everyday Offset", transactions: [reviewA] }),
    ];

    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await uploadScreenshots(page, files);

    await expect(page.getByText("8 screenshots processed")).toBeVisible();
    await expect(page.getByText("3 sources detected")).toBeVisible();
    await expect(page.getByText("8 transactions found")).toBeVisible();
    await expect(page.getByText("4 new")).toBeVisible();
    await expect(page.getByText("2 already known")).toBeVisible();
    await expect(page.getByText("2 need review")).toBeVisible();
    await expect(page.getByText("1 screenshot couldn't be read")).toBeVisible();

    // Amex's unsigned amount normalizes to DEBIT (expenditure), never CREDIT.
    const amexTx = await prisma.transaction.findFirstOrThrow({ where: { originalDescription: { contains: "COLES BROOKSIDE" } } });
    expect(amexTx.direction).toBe("DEBIT");

    // The overlapping CBA transaction was inserted exactly once.
    const colesCount = await prisma.transaction.count({ where: { originalDescription: cbaColes.description, amount: 45.3 } });
    expect(colesCount).toBe(1);

    // Both sides of the genuinely ambiguous pair exist and are flagged.
    const flagged = await prisma.transaction.findMany({ where: { originalDescription: { in: [reviewA.description, reviewB.description] } } });
    expect(flagged).toHaveLength(2);
    expect(flagged.every((t) => t.possibleDuplicateOfId !== null)).toBe(true);
  });

  test("an existing pending transaction is updated to posted, not duplicated, when a later screenshot shows it posted", async ({ page }) => {
    const pendingRow = { date: daysAgo(6), description: `SPOTLIGHT PTY LTD STH MELBOURNE ${RUN_ID}`, amount: "56.00", direction: "DEBIT" as const, status: "PENDING" as const, confidence: 0.9 };
    const postedRow = { ...pendingRow, date: daysAgo(4), status: "POSTED" as const };

    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);

    await uploadScreenshots(page, [fixture("virgin-pending-only.png", { source: "VIRGIN_MONEY", accountHint: "Velocity High Flyer Card", transactions: [pendingRow] })]);
    await expect(page.getByText("1 new")).toBeVisible();

    const beforeCount = await prisma.transaction.count({ where: { originalDescription: pendingRow.description } });
    expect(beforeCount).toBe(1);
    const beforeRow = await prisma.transaction.findFirstOrThrow({ where: { originalDescription: pendingRow.description } });
    expect(beforeRow.status).toBe("PENDING");

    await uploadScreenshots(page, [fixture("virgin-posted-only.png", { source: "VIRGIN_MONEY", accountHint: "Velocity High Flyer Card", transactions: [postedRow] })]);
    await expect(page.getByText("1 already known")).toBeVisible();
    await expect(page.getByText("0 new")).toBeVisible();

    const afterCount = await prisma.transaction.count({ where: { originalDescription: pendingRow.description } });
    expect(afterCount).toBe(1); // still exactly one row, not two
    const afterRow = await prisma.transaction.findFirstOrThrow({ where: { originalDescription: pendingRow.description } });
    expect(afterRow.id).toBe(beforeRow.id);
    expect(afterRow.status).toBe("POSTED");
  });

  test("re-uploading the exact same batch dedupes entirely against what's already stored", async ({ page }) => {
    const row = { date: daysAgo(7), description: `AHM HEALTH INSURANCE WOLLONGONG ${RUN_ID}`, amount: "16.13", direction: "DEBIT" as const, status: "POSTED" as const, confidence: 0.95 };
    const files = [fixture("amex-repeat.png", { source: "AMEX", accountHint: "Velocity Platinum", transactions: [row] })];

    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await uploadScreenshots(page, files);
    await expect(page.getByText("1 new")).toBeVisible();

    await uploadScreenshots(page, files);
    await expect(page.getByText("1 already known")).toBeVisible();
    await expect(page.getByText("0 new")).toBeVisible();

    const count = await prisma.transaction.count({ where: { originalDescription: row.description } });
    expect(count).toBe(1);
  });

  test("a household member can resolve a flagged possible duplicate as separate or as a duplicate", async ({ page }) => {
    // A weak (ambiguous) match flags BOTH sides, each pointing at the other
    // — exercised as two independent resolutions below.
    const first = { date: daysAgo(8), description: `GRILLD EVERTON PARK STORE A ${RUN_ID}`, amount: "47.50", direction: "DEBIT" as const, status: "POSTED" as const, confidence: 0.9 };
    const second = { date: daysAgo(8), description: `GRILLD EVERTON PARK STORE B ${RUN_ID}`, amount: "47.50", direction: "DEBIT" as const, status: "POSTED" as const, confidence: 0.9 };

    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await uploadScreenshots(page, [fixture("cba-pair.png", { source: "CBA", accountHint: "Everyday Offset", transactions: [first, second] })]);
    await expect(page.getByText("2 need review")).toBeVisible();

    const flaggedPair = await prisma.transaction.findMany({
      where: { possibleDuplicateOfId: { not: null }, originalDescription: { in: [first.description, second.description] } },
    });
    expect(flaggedPair).toHaveLength(2);
    const [keepSeparateTx, markDuplicateTx] = flaggedPair;

    await page.goto(`/transactions/${keepSeparateTx!.id}`);
    await expect(page.getByText("Possible duplicate")).toBeVisible();
    await page.getByRole("button", { name: "These are separate" }).click();
    // keepAsSeparateTransaction doesn't redirect (same URL either way), so
    // wait for the actual DOM/DB effect rather than a URL change.
    await expect(page.getByText("Possible duplicate")).toBeHidden({ timeout: 15_000 });
    const cleared = await prisma.transaction.findUniqueOrThrow({ where: { id: keepSeparateTx!.id } });
    expect(cleared.possibleDuplicateOfId).toBeNull();

    const countBeforeDelete = await prisma.transaction.count({ where: { originalDescription: { in: [first.description, second.description] } } });
    await page.goto(`/transactions/${markDuplicateTx!.id}`);
    await page.getByRole("button", { name: "This is a duplicate — remove it" }).click();
    await expect(page).toHaveURL("/transactions");

    const countAfterDelete = await prisma.transaction.count({ where: { originalDescription: { in: [first.description, second.description] } } });
    expect(countAfterDelete).toBe(countBeforeDelete - 1);
    const stillExists = await prisma.transaction.findUnique({ where: { id: keepSeparateTx!.id } });
    expect(stillExists).not.toBeNull();
    const deleted = await prisma.transaction.findUnique({ where: { id: markDuplicateTx!.id } });
    expect(deleted).toBeNull();
  });

  test("no image bytes are ever persisted anywhere in the schema", async () => {
    const columns = await prisma.$queryRaw<Array<{ table_name: string; column_name: string }>>`
      SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = 'public'
        AND (column_name ILIKE '%screenshot%' OR column_name ILIKE '%image%' OR column_name ILIKE '%photo%')
    `;
    expect(columns).toHaveLength(0);
  });
});

test.describe("Batch screenshot import — access", () => {
  test("a non-admin household member can also use the import page", async ({ page }) => {
    await login(page, MEMBER_EMAIL, MEMBER_PASSWORD);
    await page.goto("/import");
    await expect(page.getByRole("heading", { name: "Import from screenshots" })).toBeVisible();
    await expect(page.locator('input[name="screenshots"]')).toBeVisible();
  });
});
