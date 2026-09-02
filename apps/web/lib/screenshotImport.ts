import "server-only";
import { prisma } from "@frodocodo/db";
import { formatCalendarDate, toMoney, type AccountType } from "@frodocodo/shared";
import {
  deriveDefaultAccountAlias,
  toIngestibleAccountFields,
  toIngestibleTransactionFields,
  normalizeMerchant,
  classifyDeterministic,
  resolveClassification,
  resolveScreenshotBatch,
  type ScreenshotDedupeCandidate,
  type ScreenshotDedupeExisting,
} from "@frodocodo/ledger";
import type { ScreenshotVisionExtractor, ScreenshotSource, ExtractedTransactionCandidate } from "@frodocodo/ai";
import { reconcileTransferReversalsAndRefunds } from "@frodocodo/worker";
import { recordAuditEvent } from "./audit";

/**
 * Batch screenshot transaction ingestion — the DB-touching orchestration
 * half (the vision extraction lives in `packages/ai`, the pure dedupe
 * fingerprinting in `packages/ledger`). Mirrors `apps/web/lib/basiqConnect.ts`'s
 * shape: this file is deliberately untested by apps/web's own vitest
 * (which only covers `next/headers`/`server-only`-free `lib/**` code — see
 * `vitest.config.ts`) and is instead exercised end-to-end by Playwright
 * (`apps/web/e2e/screenshot-import.spec.ts`), the same precedent Task 7C's
 * `basiqConnect.ts` established.
 *
 * PRIVACY: `files` are plain in-memory buffers this function reads from
 * and never writes anywhere — no temp file, no object storage, no DB
 * column. Once this function returns, nothing durable references the
 * image bytes; they are reclaimed by the garbage collector like any other
 * request-scoped memory. There is no "delete the screenshot" step because
 * there is nothing persisted to delete.
 */

export interface ScreenshotFileInput {
  buffer: Buffer;
  mediaType: string;
}

export interface ScreenshotImportSummary {
  screenshotsProcessed: number;
  screenshotsUnrecognized: number;
  sourcesDetected: string[];
  transactionsFound: number;
  newTransactions: number;
  alreadyKnown: number;
  needsReview: number;
}

const SOURCE_INSTITUTION: Record<Exclude<ScreenshotSource, "UNKNOWN">, { shortName: string; name: string; accountType: AccountType }> = {
  CBA: { shortName: "CBA", name: "Commonwealth Bank of Australia", accountType: "TRANSACTION" },
  VIRGIN_MONEY: { shortName: "Virgin", name: "Virgin Money Australia", accountType: "CREDIT_CARD" },
  AMEX: { shortName: "Amex", name: "American Express Australia", accountType: "CREDIT_CARD" },
};

function sourceLabel(source: ScreenshotSource): string {
  return source === "VIRGIN_MONEY" ? "Virgin" : source === "UNKNOWN" ? "Unknown" : source;
}

/**
 * Processes an entire upload batch — arbitrary source mix, arbitrary
 * order, arbitrary overlap — and returns a summary. `extractor` is
 * injected (never resolved internally) so callers control exactly which
 * vision backend runs, the same DI pattern `BasiqProvider` uses for its
 * HTTP client: production code gets `getScreenshotVisionExtractor()`
 * (`apps/web/lib/screenshotExtractorFactory.ts`); tests inject a fake.
 */
export async function importScreenshotBatch(
  files: ScreenshotFileInput[],
  householdId: string,
  actorUserId: string,
  extractor: ScreenshotVisionExtractor,
): Promise<ScreenshotImportSummary> {
  const todayIso = formatCalendarDate(new Date());

  interface Extraction {
    sourceKey: string;
    source: Exclude<ScreenshotSource, "UNKNOWN">;
    rows: ExtractedTransactionCandidate[];
  }
  const extractions: Extraction[] = [];
  let screenshotsUnrecognized = 0;

  for (let i = 0; i < files.length; i++) {
    const file = files[i]!;
    let result;
    try {
      result = await extractor({ base64: file.buffer.toString("base64"), mediaType: file.mediaType }, { todayIso });
    } catch {
      result = { source: "UNKNOWN" as const, accountHint: null, transactions: [] };
    }
    if (result.source === "UNKNOWN") {
      screenshotsUnrecognized++;
      continue;
    }
    if (result.transactions.length === 0) continue; // recognized, but nothing usable extracted — not an "unrecognized" screenshot
    extractions.push({ sourceKey: `screenshot-${i}`, source: result.source, rows: result.transactions });
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
    };
  }

  const accountBySource = new Map<Exclude<ScreenshotSource, "UNKNOWN">, string>();
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
        data: { status: "POSTED", postingDate: new Date(candidate.transactionDate) },
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

    const id = await createScreenshotTransaction(
      householdId,
      candidate,
      outcome.action === "NEEDS_REVIEW" ? (outcome.possibleDuplicateOfExistingId ?? null) : null,
    );
    createdIdByCandidateIndex.set(i, id);
    if (outcome.action === "NEEDS_REVIEW") needsReview++;
    else newTransactions++;
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
async function resolveScreenshotAccount(householdId: string, source: Exclude<ScreenshotSource, "UNKNOWN">): Promise<string> {
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
}

/** Same normalize -> classify -> create sequence `apps/worker/src/syncConnection.ts` uses for a live sync, applied to one screenshot-sourced row. */
async function createScreenshotTransaction(
  householdId: string,
  input: ScreenshotTransactionInput,
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

  const merchant = normalizeMerchant(ingestible.originalDescription);
  const merchantRow = await prisma.merchant.upsert({
    where: { householdId_matchKey: { householdId, matchKey: merchant.matchKey } },
    update: {},
    create: { householdId, normalizedName: merchant.normalizedName, matchKey: merchant.matchKey },
  });
  const rule = await prisma.merchantRule.findUnique({
    where: { householdId_merchantId: { householdId, merchantId: merchantRow.id } },
  });
  const deterministic = classifyDeterministic({
    merchantRule: rule ? { categoryId: rule.categoryId, ruleId: rule.id } : undefined,
    learnedMapping: merchantRow.defaultCategoryId ? { categoryId: merchantRow.defaultCategoryId, confidence: 0.85 } : undefined,
  });
  const classification = resolveClassification(deterministic, null);

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
      normalizedMerchantId: merchantRow.id,
      merchantConfidence: merchant.confidence,
      categoryId: classification.status === "CLASSIFIED" ? classification.categoryId : null,
      classificationConfidence: classification.status === "CLASSIFIED" ? classification.confidence : null,
      classificationSource: classification.status === "CLASSIFIED" ? classification.source : null,
      suggestedCategoryId: classification.status === "NEEDS_REVIEW" ? (classification.bestGuessCategoryId ?? null) : null,
      suggestedCategorySource: classification.status === "NEEDS_REVIEW" ? (classification.bestGuessSource ?? null) : null,
      suggestedCategoryConfidence: classification.status === "NEEDS_REVIEW" ? (classification.bestGuessConfidence ?? null) : null,
      possibleDuplicateOfId,
    },
    select: { id: true },
  });
  return created.id;
}
