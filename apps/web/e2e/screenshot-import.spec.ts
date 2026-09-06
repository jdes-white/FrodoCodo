import { test, expect, type Page, type Locator } from "@playwright/test";
import { prisma } from "@frodocodo/db";
import { TEST_FIXTURE_MARKER, type ScreenshotExtractionFixture } from "@frodocodo/ai";

/**
 * Batch screenshot transaction import, exercised end-to-end against the
 * real deployed app — the running dev server has no AI_PROVIDER=anthropic
 * configured in this suite, so `getScreenshotVisionExtractor()`
 * (apps/web/lib/screenshotExtractorFactory.ts) resolves to the stub
 * extractor (`packages/ai/src/screenshotExtraction.ts`), which replays a
 * `TEST_FIXTURE_MARKER`-prefixed JSON payload through the exact same
 * validation/normalization path a real Anthropic response would go
 * through. This proves the real upload -> extraction -> account
 * resolution -> dedupe -> classification -> reconciliation -> persisted
 * batch pipeline, with only the vision call itself faked — the same
 * relationship MockProvider has to BasiqProvider.
 *
 * Screenshot-to-budget closure pass: the result of an import is no longer
 * read off transient client state — `uploadScreenshots` below captures the
 * `importBatchId` straight from the `/api/import` response (the same id
 * `ImportScreenshotsForm` never renders directly anymore) and every
 * assertion after that either queries the database directly (the
 * `ImportBatch` row + its linked `Transaction` rows, exactly what
 * `apps/web/lib/importBatches.ts` reconstructs) or scopes UI assertions to
 * that one batch's `[data-testid="import-batch"]` element, so accumulating
 * import history across repeated runs of this spec can never make an
 * assertion ambiguous.
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

function fixture(name: string, result: ScreenshotExtractionFixture) {
  return { name, mimeType: "image/png", buffer: Buffer.from(TEST_FIXTURE_MARKER + JSON.stringify(result), "utf8") };
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

/**
 * Uploads a batch and returns the durable `importBatchId` the server
 * assigned it — captured straight from the `/api/import` JSON response, not
 * inferred from anything rendered on the page, since that response is the
 * one moment the id is available before the page's own re-render (driven by
 * `router.refresh()`) settles.
 */
async function uploadScreenshots(page: Page, files: ReturnType<typeof fixture>[]): Promise<string> {
  await page.goto("/import");
  await page.locator('input[name="screenshots"]').setInputFiles(files);
  const [response] = await Promise.all([
    page.waitForResponse((r) => r.url().includes("/api/import") && r.request().method() === "POST"),
    page.getByRole("button", { name: "Upload and process" }).click(),
  ]);
  const body = (await response.json()) as { summary?: { importBatchId: string }; error?: string };
  if (!response.ok() || !body.summary) {
    throw new Error(`Upload failed: ${body.error ?? response.status()}`);
  }
  await expect(page.getByText("Processed — see Recent imports below.")).toBeVisible({ timeout: 15_000 });
  return body.summary.importBatchId;
}

/** Scopes assertions to exactly one batch's rendered card, however many other batches have accumulated on the page from earlier runs. */
function batchCard(page: Page, importBatchId: string): Locator {
  return page.locator(`[data-testid="import-batch"][data-batch-id="${importBatchId}"]`);
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
    const importBatchId = await uploadScreenshots(page, files);
    const card = batchCard(page, importBatchId);

    await expect(card.getByText("8 screenshots processed")).toBeVisible();
    await expect(card.getByText(/3 sources detected/)).toBeVisible();
    await expect(card.getByText("8 transactions found")).toBeVisible();
    await expect(card.getByText("1 screenshot couldn't be read")).toBeVisible();

    // The persisted ImportBatch row (what apps/web/lib/importBatches.ts
    // reconstructs the card above from) is the actual source of truth —
    // asserted directly rather than re-derived from rendered text.
    const dbBatch = await prisma.importBatch.findUniqueOrThrow({ where: { id: importBatchId } });
    expect(dbBatch.transactionsFound).toBe(8);
    expect(dbBatch.alreadyKnownCount).toBe(2); // the overlapping Coles row + one member of the ambiguous pair, deduped within the batch
    expect(dbBatch.screenshotsUnrecognized).toBe(1);
    expect(dbBatch.unreadableTransactionCount).toBe(0);

    // Every row this batch actually created carries its id — this is what
    // makes `/transactions?importBatchId=...` and the reconstruction in
    // importBatches.ts possible at all.
    const batchTransactions = await prisma.transaction.findMany({ where: { importBatchId } });
    expect(batchTransactions).toHaveLength(6); // 8 found - 2 already known

    // Amex's unsigned amount normalizes to DEBIT (expenditure), never CREDIT.
    const amexTx = await prisma.transaction.findFirstOrThrow({ where: { originalDescription: { contains: "COLES BROOKSIDE" } } });
    expect(amexTx.direction).toBe("DEBIT");
    expect(amexTx.importBatchId).toBe(importBatchId);

    // The overlapping CBA transaction was inserted exactly once.
    const colesCount = await prisma.transaction.count({ where: { originalDescription: cbaColes.description, amount: 45.3 } });
    expect(colesCount).toBe(1);

    // Both sides of the genuinely ambiguous pair exist, are flagged, and
    // are attributed to this batch — reconstructable as POSSIBLE_DUPLICATE
    // even after this test's own assertions are the only thing looking at
    // them (no page state involved in this check at all).
    const flagged = await prisma.transaction.findMany({ where: { originalDescription: { in: [reviewA.description, reviewB.description] } } });
    expect(flagged).toHaveLength(2);
    expect(flagged.every((t) => t.possibleDuplicateOfId !== null && t.importBatchId === importBatchId)).toBe(true);

    // The confidently-recognised salary credit is excluded from spending,
    // not sent begging for a category — the categorisation closure pass's
    // financial-movement detection, verified here in the real end-to-end
    // ingestion path rather than only at the pure-function level.
    const salaryTx = await prisma.transaction.findFirstOrThrow({ where: { originalDescription: cbaSalary.description } });
    expect(salaryTx.isExcludedFromBudget).toBe(true);
    expect(salaryTx.categoryId).toBeNull();
    expect(salaryTx.classificationSource).toBe("SYSTEM");
  });

  test("an existing pending transaction is updated to posted, not duplicated, when a later screenshot shows it posted", async ({ page }) => {
    const pendingRow = { date: daysAgo(6), description: `SPOTLIGHT PTY LTD STH MELBOURNE ${RUN_ID}`, amount: "56.00", direction: "DEBIT" as const, status: "PENDING" as const, confidence: 0.9 };
    const postedRow = { ...pendingRow, date: daysAgo(4), status: "POSTED" as const };

    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);

    const firstBatchId = await uploadScreenshots(page, [fixture("virgin-pending-only.png", { source: "VIRGIN_MONEY", accountHint: "Velocity High Flyer Card", transactions: [pendingRow] })]);
    const firstBatch = await prisma.importBatch.findUniqueOrThrow({ where: { id: firstBatchId } });
    expect(firstBatch.alreadyKnownCount).toBe(0);

    const beforeCount = await prisma.transaction.count({ where: { originalDescription: pendingRow.description } });
    expect(beforeCount).toBe(1);
    const beforeRow = await prisma.transaction.findFirstOrThrow({ where: { originalDescription: pendingRow.description } });
    expect(beforeRow.status).toBe("PENDING");
    expect(beforeRow.importBatchId).toBe(firstBatchId);

    const secondBatchId = await uploadScreenshots(page, [fixture("virgin-posted-only.png", { source: "VIRGIN_MONEY", accountHint: "Velocity High Flyer Card", transactions: [postedRow] })]);
    const secondBatch = await prisma.importBatch.findUniqueOrThrow({ where: { id: secondBatchId } });
    expect(secondBatch.alreadyKnownCount).toBe(1); // the update-in-place counts as "already known" for this batch, not a new row

    const afterCount = await prisma.transaction.count({ where: { originalDescription: pendingRow.description } });
    expect(afterCount).toBe(1); // still exactly one row, not two
    const afterRow = await prisma.transaction.findFirstOrThrow({ where: { originalDescription: pendingRow.description } });
    expect(afterRow.id).toBe(beforeRow.id);
    expect(afterRow.status).toBe("POSTED");
    // The row still belongs to the FIRST batch that created it — an
    // in-place status update is not a new import, so it never gets
    // reassigned to the batch that merely touched it.
    expect(afterRow.importBatchId).toBe(firstBatchId);
  });

  test("re-uploading the exact same batch dedupes entirely against what's already stored", async ({ page }) => {
    const row = { date: daysAgo(7), description: `AHM HEALTH INSURANCE WOLLONGONG ${RUN_ID}`, amount: "16.13", direction: "DEBIT" as const, status: "POSTED" as const, confidence: 0.95 };
    const files = [fixture("amex-repeat.png", { source: "AMEX", accountHint: "Velocity Platinum", transactions: [row] })];

    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    const firstBatchId = await uploadScreenshots(page, files);
    expect((await prisma.importBatch.findUniqueOrThrow({ where: { id: firstBatchId } })).alreadyKnownCount).toBe(0);

    const secondBatchId = await uploadScreenshots(page, files);
    const secondBatch = await prisma.importBatch.findUniqueOrThrow({ where: { id: secondBatchId } });
    expect(secondBatch.alreadyKnownCount).toBe(1);
    expect(secondBatch.transactionsFound).toBe(1);
    const secondBatchRowCount = await prisma.transaction.count({ where: { importBatchId: secondBatchId } });
    expect(secondBatchRowCount).toBe(0); // nothing new was created by the repeat upload

    const count = await prisma.transaction.count({ where: { originalDescription: row.description } });
    expect(count).toBe(1);
  });

  test("a household member can resolve a flagged possible duplicate as separate or as a duplicate", async ({ page }) => {
    // A weak (ambiguous) match flags BOTH sides, each pointing at the other
    // — exercised as two independent resolutions below.
    const first = { date: daysAgo(8), description: `GRILLD EVERTON PARK STORE A ${RUN_ID}`, amount: "47.50", direction: "DEBIT" as const, status: "POSTED" as const, confidence: 0.9 };
    const second = { date: daysAgo(8), description: `GRILLD EVERTON PARK STORE B ${RUN_ID}`, amount: "47.50", direction: "DEBIT" as const, status: "POSTED" as const, confidence: 0.9 };

    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    const importBatchId = await uploadScreenshots(page, [fixture("cba-pair.png", { source: "CBA", accountHint: "Everyday Offset", transactions: [first, second] })]);
    await expect(batchCard(page, importBatchId).getByText(/2 possible duplicates/)).toBeVisible();

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
    // Resolving the flag doesn't erase the batch attribution — the batch
    // view still accounts for this row, now reconstructed as CATEGORISED
    // or CATEGORY_REVIEW rather than POSSIBLE_DUPLICATE.
    expect(cleared.importBatchId).toBe(importBatchId);

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

  test("screenshot upload bytes never leak into audit log metadata", async ({ page }) => {
    const row = { date: daysAgo(1), description: `AUDIT LEAK CHECK ${RUN_ID}`, amount: "9.99", direction: "DEBIT" as const, status: "POSTED" as const, confidence: 0.9 };
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await uploadScreenshots(page, [fixture("audit-check.png", { source: "CBA", accountHint: "Everyday Offset", transactions: [row] })]);

    const events = await prisma.auditEvent.findMany({ where: { action: "SCREENSHOT_IMPORT" }, orderBy: { createdAt: "desc" }, take: 1 });
    expect(events).toHaveLength(1);
    const metadataText = JSON.stringify(events[0]!.metadata);
    // The audit event carries only the summary's counts (see
    // apps/web/lib/screenshotImport.ts's recordAuditEvent call) — never the
    // raw fixture bytes, the TEST_FIXTURE_MARKER itself, or the row's own
    // description text.
    expect(metadataText).not.toContain(TEST_FIXTURE_MARKER);
    expect(metadataText).not.toContain(row.description);
  });

  test("a plausible but uncertain (low-confidence) row is imported and flagged for review, never silently dropped", async ({ page }) => {
    const uncertainRow = { date: daysAgo(2), description: `BLURRY MERCHANT NAME ${RUN_ID}`, amount: "18.40", direction: "DEBIT" as const, status: "POSTED" as const, confidence: 0.35 };
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    const importBatchId = await uploadScreenshots(page, [fixture("uncertain.png", { source: "CBA", accountHint: "Everyday Offset", transactions: [uncertainRow] })]);

    const card = batchCard(page, importBatchId);
    await expect(card.getByText("1 transaction found")).toBeVisible();
    await expect(card.getByText(/1 low-confidence read/)).toBeVisible();

    const tx = await prisma.transaction.findFirstOrThrow({ where: { originalDescription: uncertainRow.description } });
    expect(tx.needsExtractionReview).toBe(true);
    expect(tx.importBatchId).toBe(importBatchId);
    // Never invented data — the exact figures the model reported, just flagged.
    expect(tx.amount.toString()).toBe("18.4");
    expect(tx.direction).toBe("DEBIT");
  });

  test("rows the model can see but can't confidently structure are counted and surfaced, never fabricated as a transaction", async ({ page }) => {
    const goodRow = { date: daysAgo(1), description: `WOOLWORTHS METRO ${RUN_ID}`, amount: "24.10", direction: "DEBIT" as const, status: "POSTED" as const, confidence: 0.92 };
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    const importBatchId = await uploadScreenshots(page, [
      fixture("partial-rows.png", { source: "CBA", accountHint: "Everyday Offset", visibleRowCount: 3, transactions: [goodRow] }),
    ]);

    // Only the one structurable row is ever counted as "found" — the other
    // two the model saw but couldn't structure are surfaced separately,
    // never silently absorbed into a "fully successful" report.
    const card = batchCard(page, importBatchId);
    await expect(card.getByText("1 transaction found")).toBeVisible();
    await expect(card.getByText("2 row(s) could not be reliably read")).toBeVisible();

    const dbBatch = await prisma.importBatch.findUniqueOrThrow({ where: { id: importBatchId } });
    expect(dbBatch.unreadableTransactionCount).toBe(2);

    const goodCount = await prisma.transaction.count({ where: { originalDescription: goodRow.description } });
    expect(goodCount).toBe(1);
  });

  test("an unrecognized/unsupported screenshot layout fails closed rather than being forwarded anywhere", async ({ page }) => {
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    const importBatchId = await uploadScreenshots(page, [fixture("unsupported-layout.png", { source: "UNKNOWN", transactions: [] })]);

    const dbBatch = await prisma.importBatch.findUniqueOrThrow({ where: { id: importBatchId } });
    expect(dbBatch.transactionsFound).toBe(0);
    expect(dbBatch.screenshotsUnrecognized).toBe(1);
  });

  test("an import result is still fully understandable after navigating away, reloading, and returning — the screenshot-to-budget closure pass's core fix", async ({ page }) => {
    const spendRow = { date: daysAgo(1), description: `KMART EVERTON PARK ${RUN_ID}`, amount: "33.00", direction: "DEBIT" as const, status: "POSTED" as const, confidence: 0.95 };
    const incomeRow = { date: daysAgo(1), description: `Salary Acme Corp ${RUN_ID}`, amount: "2500.00", direction: "CREDIT" as const, status: "POSTED" as const, confidence: 0.95 };
    const uncertainTransfer = { date: daysAgo(1), description: `Transfer to Holiday Fund ${RUN_ID}`, amount: "200.00", direction: "DEBIT" as const, status: "POSTED" as const, confidence: 0.9 };

    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    const importBatchId = await uploadScreenshots(page, [
      fixture("mixed.png", { source: "CBA", accountHint: "Everyday Offset", transactions: [spendRow, incomeRow, uncertainTransfer] }),
    ]);

    // Navigate away, reload, and come back — the exact user journey the
    // task's acceptance test describes. No query param, no client state
    // carries the batch id across any of this; it's re-derived purely from
    // the database on each fresh page load.
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
    await page.goto("/import");
    await page.reload();

    const card = batchCard(page, importBatchId);
    await expect(card).toBeVisible();
    await expect(card.getByText("3 transactions found")).toBeVisible();
    await expect(card.getByText(/1 excluded as income\/transfer/)).toBeVisible();
    await expect(card.getByText(/1 might not be spending — review needed/)).toBeVisible();

    // The reconstruction is a live read of current transaction state, not a
    // frozen snapshot — confirmed directly against the database, which is
    // exactly what apps/web/lib/importBatches.ts queries.
    const salary = await prisma.transaction.findFirstOrThrow({ where: { originalDescription: incomeRow.description } });
    expect(salary.isExcludedFromBudget).toBe(true);
    expect(salary.categoryId).toBeNull();

    const transfer = await prisma.transaction.findFirstOrThrow({ where: { originalDescription: uncertainTransfer.description } });
    expect(transfer.needsFinancialMovementReview).toBe(true);
    expect(transfer.isExcludedFromBudget).toBe(false); // conservative: never silently excluded

    // The "View these transactions" link scopes Transactions to exactly
    // this batch, regardless of which calendar month its rows fall in.
    await card.getByRole("link", { name: "View these transactions →" }).click();
    await expect(page).toHaveURL(new RegExp(`/transactions\\?importBatchId=${importBatchId}`));
    // "Kmart" is a known-alias merchant name (normalizeMerchant.ts), so it
    // renders identically regardless of how the other two (unaliased, still
    // RUN_ID-tagged) descriptions get title-cased — a stable signal that
    // this batch's spend row is actually present on the filtered page.
    await expect(page.getByText("Kmart")).toBeVisible();
    const rowsInBatch = await prisma.transaction.count({ where: { importBatchId } });
    expect(rowsInBatch).toBe(3);
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
