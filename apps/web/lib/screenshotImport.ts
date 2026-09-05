import "server-only";
import { prisma } from "@frodocodo/db";
import { formatCalendarDate, toMoney, type AccountType } from "@frodocodo/shared";
import {
  deriveDefaultAccountAlias,
  toIngestibleAccountFields,
  toIngestibleTransactionFields,
  resolveScreenshotBatch,
  type ScreenshotDedupeCandidate,
  type ScreenshotDedupeExisting,
} from "@frodocodo/ledger";
import type { ScreenshotSource, ScreenshotVisionExtractor, ExtractedTransactionCandidate, CategorySuggestionBatchExtractor } from "@frodocodo/ai";
import { reconcileTransferReversalsAndRefunds, classifyTransactionBatch, type BatchedClassificationResult } from "@frodocodo/worker";
import { recordAuditEvent } from "./audit";
import { sanitizeScreenshot } from "./screenshotSanitizer";

/**
 * Batch screenshot transaction ingestion — the DB-touching orchestration
 * half (image sanitisation lives in `./screenshotSanitizer.ts`, right next
 * to this file rather than in `packages/ai` alongside vision extraction —
 * see that module's doc comment for why; vision extraction itself is in
 * `packages/ai/src/screenshotExtraction.ts`, the pure dedupe fingerprinting
 * in `packages/ledger`). Mirrors
 * `apps/web/lib/basiqConnect.ts`'s shape: this file is deliberately
 * untested by apps/web's own vitest (which only covers
 * `next/headers`/`server-only`-free `lib/**` code — see `vitest.config.ts`)
 * and is instead exercised end-to-end by Playwright
 * (`apps/web/e2e/screenshot-import.spec.ts`), the same precedent Task 7C's
 * `basiqConnect.ts` established.
 *
 * PRIVACY: `files` are plain in-memory buffers this function reads from
 * and never writes anywhere — no temp file, no object storage, no DB
 * column. Every uploaded screenshot is run through `sanitizeScreenshot`
 * first, which crops away the header/balance/nav chrome before *anything*
 * is sent to a vision model — see that module's doc comment for exactly
 * what is removed and why. Both the original upload buffer and the
 * sanitized crop live only in this request's memory; once this function
 * returns, nothing durable references either — no temp file, no object
 * storage, no DB column, no log line. There is no "delete the screenshot"
 * step because there is nothing persisted to delete.
 *
 * NO SILENT LOSS: a screenshot whose layout can't be safely sanitized, or
 * whose extraction call fails outright, is counted in
 * `screenshotsUnrecognized` rather than silently skipped. A row the model
 * could see but not confidently structure is counted in
 * `unreadableTransactionCount` rather than vanishing. A row the model
 * could structure but wasn't fully confident about is still imported, just
 * flagged `needsExtractionReview` — see `packages/ai/src/screenshotExtraction.ts`'s
 * doc comment for the three-way outcome this implements.
 *
 * DIAGNOSABILITY: `screenshotsUnrecognized` intentionally merges two very
 * different situations into one user-facing count — a screenshot whose
 * layout genuinely isn't one of the three known apps, and a screenshot
 * whose layout WAS recognized but whose vision extraction call itself
 * failed (most commonly: no AI provider configured, or a real provider
 * error). A real-screenshot test that reports every upload as
 * unrecognized is easy to misdiagnose as "the sanitizer's colour
 * calibration is broken" when the actual cause is the latter — this
 * module logs the two cases distinctly (`scope: "screenshotImport"`,
 * `event: "sanitization_rejected"` vs `"extraction_failed"`, both with a
 * content-free `reason`) precisely so that distinction is checkable from
 * server logs without changing the summary contract callers already rely
 * on.
 */

export interface ScreenshotFileInput {
  buffer: Buffer;
  mediaType: string;
}

export interface ScreenshotImportSummary {
  screenshotsProcessed: number;
  /** Screenshots that couldn't be safely sanitized (unsupported/unrecognized layout) or whose extraction call failed outright — never silently skipped, always counted. */
  screenshotsUnrecognized: number;
  sourcesDetected: string[];
  transactionsFound: number;
  newTransactions: number;
  alreadyKnown: number;
  /** Transactions imported but flagged for a quick human glance — either a genuinely ambiguous possible duplicate, or a row the vision model wasn't fully confident about. */
  needsReview: number;
  /** Rows the vision model could see existed in a screenshot's transaction list but could not confidently (or validly) structure at all — never imported (no fabricated data), never silently absorbed into a "clean" result. */
  unreadableTransactionCount: number;
}

const SOURCE_INSTITUTION: Record<ScreenshotSource, { shortName: string; name: string; accountType: AccountType }> = {
  CBA: { shortName: "CBA", name: "Commonwealth Bank of Australia", accountType: "TRANSACTION" },
  VIRGIN_MONEY: { shortName: "Virgin", name: "Virgin Money Australia", accountType: "CREDIT_CARD" },
  AMEX: { shortName: "Amex", name: "American Express Australia", accountType: "CREDIT_CARD" },
};

function sourceLabel(source: ScreenshotSource): string {
  return source === "VIRGIN_MONEY" ? "Virgin" : source;
}

/**
 * Processes an entire upload batch — arbitrary source mix, arbitrary
 * order, arbitrary overlap — and returns a summary. `extractor` is
 * injected (never resolved internally) so callers control exactly which
 * vision backend runs, the same DI pattern `BasiqProvider` uses for its
 * HTTP client: production code gets `getScreenshotVisionExtractor()`
 * (`apps/web/lib/screenshotExtractorFactory.ts`); tests inject a fake.
 * Sanitisation (`sanitizeScreenshot`) is never injected — it needs no API
 * key and no environment-dependent selection, so the same real
 * implementation always runs; its own `TEST_FIXTURE_MARKER` bypass is what
 * lets Playwright exercise this whole pipeline without real images.
 */
export async function importScreenshotBatch(
  files: ScreenshotFileInput[],
  householdId: string,
  actorUserId: string,
  extractor: ScreenshotVisionExtractor,
  categorySuggestionExtractor: CategorySuggestionBatchExtractor,
): Promise<ScreenshotImportSummary> {
  const todayIso = formatCalendarDate(new Date());

  interface Extraction {
    sourceKey: string;
    source: ScreenshotSource;
    rows: ExtractedTransactionCandidate[];
  }
  const extractions: Extraction[] = [];
  let screenshotsUnrecognized = 0;
  let unreadableTransactionCount = 0;

  for (let i = 0; i < files.length; i++) {
    const file = files[i]!;

    const sanitized = await sanitizeScreenshot(file.buffer, file.mediaType);
    if (sanitized.status === "UNSUPPORTED_LAYOUT") {
      // Fails closed: the original bytes are never forwarded to the
      // extractor in any form — this screenshot simply isn't processed.
      // Logged distinctly from an extraction failure below (both currently
      // collapse into the same user-facing "couldn't be read" count, which
      // made a real screenshot rejection indistinguishable from an
      // unconfigured/broken AI provider from the summary alone — see this
      // module's doc comment). The reason string here is always one of
      // sanitizeScreenshot's own static, content-free messages.
      console.log(JSON.stringify({ scope: "screenshotImport", event: "sanitization_rejected", reason: sanitized.reason }));
      screenshotsUnrecognized++;
      continue;
    }

    let result;
    try {
      result = await extractor(sanitized.image, { todayIso, knownSource: sanitized.layout });
    } catch (err) {
      result = { status: "EXTRACTION_FAILED" as const, reason: err instanceof Error ? err.message : "extractor threw" };
    }
    if (result.status === "EXTRACTION_FAILED") {
      // Distinct from a sanitization rejection above — this screenshot's
      // layout WAS correctly identified; the vision call itself failed
      // (e.g. no AI provider configured, or a real provider/API error).
      // `reason` is either the stub's static "no provider configured"
      // message or an SDK/HTTP error message — never user-supplied image
      // content.
      console.log(JSON.stringify({ scope: "screenshotImport", event: "extraction_failed", layout: sanitized.layout, reason: result.reason }));
      screenshotsUnrecognized++;
      continue;
    }

    unreadableTransactionCount += result.unparseableRowCount;
    if (result.transactions.length === 0) continue; // recognized, but nothing usable extracted — not an "unrecognized" screenshot
    extractions.push({ sourceKey: `screenshot-${i}`, source: sanitized.layout, rows: result.transactions });
  }

  const sourcesDetected = [...new Set(extractions.map((e) => e.source))];

  if (extractions.length === 0) {
    return {
      screenshotsProcessed: files.length,
      screenshotsUnrecognized,
      sourcesDetected: [],
      transactionsFound: 0,
      newTransactions: 0,
      alreadyKnown: 0,
      needsReview: 0,
      unreadableTransactionCount,
    };
  }

  const accountBySource = new Map<ScreenshotSource, string>();
  for (const source of sourcesDetected) {
    accountBySource.set(source, await resolveScreenshotAccount(householdId, source));
  }

  interface BuiltCandidate {
    accountId: string;
    sourceKey: string;
    transactionDate: string;
    amount: ReturnType<typeof toMoney>;
    direction: "DEBIT" | "CREDIT";
    status: "PENDING" | "POSTED";
    description: string;
    confidence: number;
    needsExtractionReview: boolean;
  }
  const built: BuiltCandidate[] = [];
  for (const extraction of extractions) {
    const accountId = accountBySource.get(extraction.source)!;
    for (const row of extraction.rows) {
      built.push({
        accountId,
        sourceKey: extraction.sourceKey,
        transactionDate: row.date,
        amount: toMoney(row.amount),
        direction: row.direction,
        status: row.status,
        description: row.description,
        confidence: row.confidence,
        needsExtractionReview: row.needsReview,
      });
    }
  }

  const transactionsFound = built.length;

  const accountIds = [...new Set(built.map((b) => b.accountId))];
  const existingRows = await prisma.transaction.findMany({
    where: { accountId: { in: accountIds } },
    select: { id: true, accountId: true, transactionDate: true, amount: true, direction: true, status: true, originalDescription: true },
  });
  const existingComparables: ScreenshotDedupeExisting[] = existingRows.map((t) => ({
    id: t.id,
    accountId: t.accountId,
    transactionDate: formatCalendarDate(t.transactionDate),
    amount: toMoney(t.amount.toString()),
    direction: t.direction,
    status: t.status,
    description: t.originalDescription,
  }));

  const candidates: ScreenshotDedupeCandidate[] = built.map((b) => ({
    accountId: b.accountId,
    transactionDate: b.transactionDate,
    amount: b.amount,
    direction: b.direction,
    status: b.status,
    description: b.description,
    sourceKey: b.sourceKey,
    confidence: b.confidence,
  }));

  const outcomes = resolveScreenshotBatch(candidates, existingComparables);

  let newTransactions = 0;
  let alreadyKnown = 0;
  let needsReview = 0;
  const createdIdByCandidateIndex = new Map<number, string>();
  const deferredSkipOfCandidate: number[] = [];
  // Candidates that will actually become a row — classified as one batch
  // (Layer 4/AI categorisation) below, before any of them are inserted.
  const toCreate: Array<{ index: number; possibleDuplicateOfExistingId: string | null }> = [];

  for (let i = 0; i < outcomes.length; i++) {
    const outcome = outcomes[i]!;
    const candidate = built[i]!;

    if (outcome.action === "SKIP_DUPLICATE") {
      alreadyKnown++;
      continue;
    }
    if (outcome.action === "UPDATE_STATUS_TO_POSTED") {
      await prisma.transaction.update({
        where: { id: outcome.matchedExistingId },
        data: {
          status: "POSTED",
          postingDate: new Date(candidate.transactionDate),
          ...(candidate.needsExtractionReview ? { needsExtractionReview: true } : {}),
        },
      });
      alreadyKnown++;
      continue;
    }
    if (outcome.action === "SKIP_DUPLICATE_OF_CANDIDATE") {
      // The candidate it duplicates may not have been created yet (batch
      // order isn't guaranteed) — resolve the count now, the row itself
      // needs nothing further since only the *kept* candidate is inserted.
      deferredSkipOfCandidate.push(i);
      continue;
    }

    toCreate.push({ index: i, possibleDuplicateOfExistingId: outcome.action === "NEEDS_REVIEW" ? (outcome.possibleDuplicateOfExistingId ?? null) : null });
  }

  if (toCreate.length > 0) {
    const classifications = await classifyTransactionBatch(
      householdId,
      toCreate.map(({ index }) => {
        const candidate = built[index]!;
        return { key: String(index), originalDescription: candidate.description, amount: candidate.amount.toString(), direction: candidate.direction };
      }),
      categorySuggestionExtractor,
    );

    for (const { index, possibleDuplicateOfExistingId } of toCreate) {
      const candidate = built[index]!;
      const outcome = outcomes[index]!;
      const classification = classifications.get(String(index))!;

      const id = await createScreenshotTransaction(candidate, classification, possibleDuplicateOfExistingId);
      createdIdByCandidateIndex.set(index, id);
      if (outcome.action === "NEEDS_REVIEW" || candidate.needsExtractionReview) needsReview++;
      else newTransactions++;
    }
  }

  for (const i of deferredSkipOfCandidate) {
    alreadyKnown++;
    void i;
  }

  // Cross-candidate NEEDS_REVIEW references only resolvable once both
  // sides of the pair exist as real rows.
  for (let i = 0; i < outcomes.length; i++) {
    const outcome = outcomes[i]!;
    if (outcome.action !== "NEEDS_REVIEW" || outcome.possibleDuplicateOfCandidateIndex === undefined) continue;
    const thisId = createdIdByCandidateIndex.get(i);
    const otherId = createdIdByCandidateIndex.get(outcome.possibleDuplicateOfCandidateIndex);
    if (thisId && otherId) {
      await prisma.transaction.update({ where: { id: thisId }, data: { possibleDuplicateOfId: otherId } });
    }
  }

  await reconcileTransferReversalsAndRefunds(householdId);

  const summary: ScreenshotImportSummary = {
    screenshotsProcessed: files.length,
    screenshotsUnrecognized,
    sourcesDetected: sourcesDetected.map(sourceLabel),
    transactionsFound,
    newTransactions,
    alreadyKnown,
    needsReview,
    unreadableTransactionCount,
  };

  // Batch-level audit event — counts only, never a raw description, image
  // reference, or account identifier (CLAUDE.md rule 12).
  await recordAuditEvent({
    householdId,
    actorUserId,
    action: "SCREENSHOT_IMPORT",
    entityType: "Household",
    entityId: householdId,
    metadata: { ...summary },
  });

  return summary;
}

/**
 * Finds or creates exactly one FrodoCodo Account per detected screenshot
 * source for this household — the household never picks an account
 * themselves. Reuses the existing `FinancialInstitution`/`FinancialConnection`/
 * `Account` model with `ConnectionMethod.MANUAL` (already modeled for
 * exactly this: a household-declared account with no live provider link)
 * and the same alias-derivation/allow-list functions every other
 * ingestion source uses — never the screenshot's own on-screen account
 * title.
 */
async function resolveScreenshotAccount(householdId: string, source: ScreenshotSource): Promise<string> {
  const info = SOURCE_INSTITUTION[source];
  const providerInstitutionId = source.toLowerCase();

  const institution = await prisma.financialInstitution.upsert({
    where: { providerName_providerInstitutionId: { providerName: "screenshot", providerInstitutionId } },
    update: {},
    create: {
      name: info.name,
      shortName: info.shortName,
      supportedConnectionMethod: "MANUAL",
      providerInstitutionId,
      providerName: "screenshot",
    },
  });

  let connection = await prisma.financialConnection.findFirst({
    where: { householdId, providerName: "screenshot", institutionId: institution.id },
  });
  if (!connection) {
    connection = await prisma.financialConnection.create({
      data: {
        householdId,
        institutionId: institution.id,
        providerName: "screenshot",
        providerConnectionId: `screenshot::${providerInstitutionId}`,
        connectionMethod: "MANUAL",
        consentStatus: "ACTIVE",
        isActive: true,
      },
    });
  }

  const providerAccountId = `screenshot::${providerInstitutionId}::primary`;
  const existingAccount = await prisma.account.findFirst({ where: { connectionId: connection.id, providerAccountId } });
  if (existingAccount) return existingAccount.id;

  const existingAliases = (
    await prisma.account.findMany({ where: { connection: { householdId } }, select: { alias: true } })
  ).map((a) => a.alias);
  const ingestible = toIngestibleAccountFields({ sourceAccountId: providerAccountId, accountType: info.accountType, currency: "AUD" });
  const alias = deriveDefaultAccountAlias(info.shortName, info.accountType, existingAliases);

  const account = await prisma.account.create({
    data: {
      connectionId: connection.id,
      providerAccountId: ingestible.providerAccountId,
      alias,
      accountType: ingestible.accountType,
      currency: ingestible.currency,
      lastSyncedAt: new Date(),
    },
  });
  return account.id;
}

interface ScreenshotTransactionInput {
  accountId: string;
  transactionDate: string;
  amount: ReturnType<typeof toMoney>;
  direction: "DEBIT" | "CREDIT";
  status: "PENDING" | "POSTED";
  description: string;
  needsExtractionReview: boolean;
}

/**
 * Same normalize -> classify -> create sequence `apps/worker/src/syncConnection.ts`
 * uses for a live sync, applied to one screenshot-sourced row — except
 * classification (merchant/rule/learned-mapping/AI) is no longer computed
 * per row here. It's pre-computed for the whole batch by the shared
 * `classifyTransactionBatch` (`@frodocodo/worker`) and simply passed in,
 * so Layer 4 (AI) gets one batched call across every unresolved merchant in
 * the upload instead of one call per row.
 */
async function createScreenshotTransaction(
  input: ScreenshotTransactionInput,
  classification: BatchedClassificationResult,
  possibleDuplicateOfId: string | null,
): Promise<string> {
  const ingestible = toIngestibleTransactionFields({
    sourceAccountId: input.accountId,
    sourceTransactionId: null, // screenshots never carry a stable source ID
    transactionDate: input.transactionDate,
    postingDate: input.status === "POSTED" ? input.transactionDate : null,
    amount: input.amount,
    direction: input.direction,
    status: input.status,
    description: input.description,
    sourceType: "SCREENSHOT_IMPORT",
  });

  const created = await prisma.transaction.create({
    data: {
      accountId: input.accountId,
      providerTransactionId: ingestible.providerTransactionId,
      transactionDate: new Date(ingestible.transactionDate),
      postingDate: ingestible.postingDate ? new Date(ingestible.postingDate) : null,
      amount: ingestible.amount.toNumber(),
      direction: ingestible.direction,
      status: ingestible.status,
      originalDescription: ingestible.originalDescription,
      sourceType: ingestible.sourceType,
      normalizedMerchantId: classification.merchantId,
      merchantConfidence: classification.merchantConfidence,
      categoryId: classification.categoryId,
      classificationConfidence: classification.classificationConfidence,
      classificationSource: classification.classificationSource,
      suggestedCategoryId: classification.suggestedCategoryId,
      suggestedCategorySource: classification.suggestedCategorySource,
      suggestedCategoryConfidence: classification.suggestedCategoryConfidence,
      isExcludedFromBudget: classification.isExcludedFromBudget,
      needsFinancialMovementReview: classification.needsFinancialMovementReview,
      possibleDuplicateOfId,
      needsExtractionReview: input.needsExtractionReview,
    },
    select: { id: true },
  });
  return created.id;
}
