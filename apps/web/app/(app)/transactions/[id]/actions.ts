"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma, Prisma } from "@frodocodo/db";
import { deriveLearnedMapping } from "@frodocodo/ledger";
import { requireSession } from "@/lib/session";
import { recordAuditEvent } from "@/lib/audit";

/**
 * How many of the household's most recent USER-sourced classifications for
 * one merchant to consider when checking whether a learned mapping should
 * form (packages/ledger/src/classification.ts's deriveLearnedMapping,
 * §12). Bounded so the "recent" in "repeated recent corrections" means
 * something — an old correction from a year ago shouldn't weigh the same
 * as one from yesterday forever. deriveLearnedMapping's own minRepeats
 * default (3) is what actually prevents a single correction from
 * retraining anything; this just bounds how far back "recent" looks.
 */
const LEARNED_MAPPING_LOOKBACK = 10;

/**
 * §32 corrections/overrides. Every write here is paired with a
 * TransactionClassification row and/or AuditEvent so the household can
 * always see *why* a total changed (§31 trust and explainability).
 *
 * Two distinct ways a correction can affect more than the one transaction,
 * both scoped carefully:
 *  - Checking "always classify this way" creates/updates an explicit
 *    MerchantRule (top precedence, §11) for *future* imports, and also
 *    immediately re-classifies any other transaction from this merchant
 *    that's still sitting uncategorised right now (`applyRuleToSiblings`)
 *    — never one the household already gave an explicit category to,
 *    since that's excluded by construction (only categoryId IS NULL rows
 *    qualify).
 *  - Independently of that checkbox, enough *repeated* recent USER
 *    corrections to the same merchant/category (`deriveLearnedMapping`,
 *    §12) promote to a learned mapping (Merchant.defaultCategoryId) — a
 *    single correction never does this on its own, and an explicit rule
 *    (if one already exists) always wins over a learned mapping anyway,
 *    so there's no point deriving one in that case.
 */
export async function reclassifyTransaction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const transactionId = String(formData.get("transactionId"));
  const categoryId = String(formData.get("categoryId"));
  const applyToFutureFromMerchant = formData.get("applyToFutureFromMerchant") === "on";

  const transaction = await prisma.transaction.findFirstOrThrow({
    where: { id: transactionId, account: { connection: { householdId: session.householdId } } },
  });

  // categoryId is a client-controlled form field (the <select> option value)
  // — verifying the transaction belongs to this household says nothing
  // about whether the category being written onto it does too. Without
  // this, a household could point its own transaction at another
  // household's categoryId and have that household's real category/bucket
  // name and colour surface on this household's own Home/Insights/Plan
  // pages via budgetSnapshot.ts's uncovered-category pass (security audit
  // finding H1). Fails closed: nothing below runs if this doesn't match.
  const ownedCategory = await prisma.category.findFirst({
    where: { id: categoryId, householdId: session.householdId },
    select: { id: true },
  });
  if (!ownedCategory) {
    throw new Error("Category does not belong to this household.");
  }

  let siblingsUpdated = 0;
  let learnedMappingCategoryId: string | null = null;

  await prisma.$transaction(async (tx) => {
    await tx.transaction.update({
      where: { id: transactionId },
      data: {
        categoryId,
        isUserOverridden: true,
        classificationSource: "USER",
        classificationConfidence: 1,
        suggestedCategoryId: null,
        suggestedCategorySource: null,
        suggestedCategoryConfidence: null,
      },
    });
    await tx.transactionClassification.create({
      data: {
        transactionId,
        categoryId,
        source: "USER",
        confidence: 1,
        createdByUserId: session.userId,
      },
    });

    if (transaction.normalizedMerchantId) {
      if (applyToFutureFromMerchant) {
        const rule = await tx.merchantRule.upsert({
          where: { householdId_merchantId: { householdId: session.householdId, merchantId: transaction.normalizedMerchantId } },
          update: { categoryId, createdById: session.userId },
          create: {
            householdId: session.householdId,
            merchantId: transaction.normalizedMerchantId,
            categoryId,
            createdById: session.userId,
          },
        });

        siblingsUpdated = await applyRuleToUnresolvedSiblings(tx, {
          householdId: session.householdId,
          merchantId: transaction.normalizedMerchantId,
          excludeTransactionId: transactionId,
          categoryId,
          ruleId: rule.id,
          userId: session.userId,
        });
      } else {
        learnedMappingCategoryId = await learnFromRecentCorrections(tx, {
          householdId: session.householdId,
          merchantId: transaction.normalizedMerchantId,
        });
      }
    }
  });

  await recordAuditEvent({
    householdId: session.householdId,
    actorUserId: session.userId,
    action: applyToFutureFromMerchant ? "RECLASSIFY_TRANSACTION_AND_CREATE_RULE" : "RECLASSIFY_TRANSACTION",
    entityType: "Transaction",
    entityId: transactionId,
    metadata: {
      categoryId,
      ...(siblingsUpdated > 0 ? { siblingsUpdated } : {}),
      ...(learnedMappingCategoryId ? { learnedMappingCategoryId } : {}),
    },
  });

  revalidatePath(`/transactions/${transactionId}`);
  revalidatePath("/transactions");
  revalidatePath("/");
}

/**
 * "Always classify this way" shouldn't leave the household's *existing*
 * uncategorised transactions from the same merchant sitting untouched in
 * the review queue right next to the one they just fixed — that's the
 * unambiguous, safe case: a transaction with no category yet has nothing
 * of the household's own judgement to overwrite. Anything that already
 * has a category (however it got one — rule, provider, an earlier manual
 * pick) is left alone by construction, since it's excluded by the
 * `categoryId: null` filter below.
 */
async function applyRuleToUnresolvedSiblings(
  tx: Prisma.TransactionClient,
  params: { householdId: string; merchantId: string; excludeTransactionId: string; categoryId: string; ruleId: string; userId: string },
): Promise<number> {
  const siblings = await tx.transaction.findMany({
    where: {
      id: { not: params.excludeTransactionId },
      normalizedMerchantId: params.merchantId,
      categoryId: null,
      account: { connection: { householdId: params.householdId } },
    },
    select: { id: true },
  });
  if (siblings.length === 0) return 0;

  await tx.transaction.updateMany({
    where: { id: { in: siblings.map((s) => s.id) } },
    data: {
      categoryId: params.categoryId,
      classificationSource: "RULE",
      classificationConfidence: 1,
      suggestedCategoryId: null,
      suggestedCategorySource: null,
      suggestedCategoryConfidence: null,
    },
  });
  await tx.transactionClassification.createMany({
    data: siblings.map((s) => ({
      transactionId: s.id,
      categoryId: params.categoryId,
      source: "RULE" as const,
      confidence: 1,
      ruleId: params.ruleId,
      createdByUserId: params.userId,
    })),
  });

  return siblings.length;
}

/**
 * §12: once the household has corrected the same merchant to the same
 * category `deriveLearnedMapping`'s minRepeats (3) or more times recently
 * — without an explicit rule already covering it, since a rule always
 * wins anyway — treat that as a learned mapping so future transactions
 * from that merchant stop needing attention even without a standing rule.
 * A single correction can never trigger this: deriveLearnedMapping itself
 * refuses until the repeat count is met.
 */
async function learnFromRecentCorrections(
  tx: Prisma.TransactionClient,
  params: { householdId: string; merchantId: string },
): Promise<string | null> {
  const existingRule = await tx.merchantRule.findUnique({
    where: { householdId_merchantId: { householdId: params.householdId, merchantId: params.merchantId } },
  });
  if (existingRule) return null;

  const recentUserClassifications = await tx.transactionClassification.findMany({
    where: {
      source: "USER",
      transaction: { normalizedMerchantId: params.merchantId, account: { connection: { householdId: params.householdId } } },
    },
    orderBy: { createdAt: "desc" },
    take: LEARNED_MAPPING_LOOKBACK,
    select: { categoryId: true },
  });

  const mapping = deriveLearnedMapping(recentUserClassifications);
  if (!mapping) return null;

  await tx.merchant.update({ where: { id: params.merchantId }, data: { defaultCategoryId: mapping.categoryId } });
  return mapping.categoryId;
}

export async function setExcludedFromBudget(formData: FormData): Promise<void> {
  const session = await requireSession();
  const transactionId = String(formData.get("transactionId"));
  const excluded = formData.get("excluded") === "on";

  await prisma.transaction.updateMany({
    where: { id: transactionId, account: { connection: { householdId: session.householdId } } },
    data: { isExcludedFromBudget: excluded },
  });

  await recordAuditEvent({
    householdId: session.householdId,
    actorUserId: session.userId,
    action: excluded ? "EXCLUDE_TRANSACTION" : "INCLUDE_TRANSACTION",
    entityType: "Transaction",
    entityId: transactionId,
  });

  revalidatePath(`/transactions/${transactionId}`);
  revalidatePath("/transactions");
  revalidatePath("/");
}

export async function markAsTransfer(formData: FormData): Promise<void> {
  const session = await requireSession();
  const transactionId = String(formData.get("transactionId"));

  await prisma.transaction.updateMany({
    where: { id: transactionId, account: { connection: { householdId: session.householdId } } },
    // Also clears financial-movement-review uncertainty (if this came from
    // that flow, packages/ledger/src/financialMovementDetection.ts) — the
    // household has now resolved the very question that flag existed to
    // raise, so it shouldn't keep sitting in the review queue for it.
    data: { isTransfer: true, isExcludedFromBudget: true, needsFinancialMovementReview: false },
  });

  await recordAuditEvent({
    householdId: session.householdId,
    actorUserId: session.userId,
    action: "MARK_TRANSACTION_AS_TRANSFER",
    entityType: "Transaction",
    entityId: transactionId,
  });

  revalidatePath(`/transactions/${transactionId}`);
  revalidatePath("/transactions");
  revalidatePath("/");
}

export async function updateNotes(formData: FormData): Promise<void> {
  const session = await requireSession();
  const transactionId = String(formData.get("transactionId"));
  const notes = String(formData.get("notes") ?? "");

  await prisma.transaction.updateMany({
    where: { id: transactionId, account: { connection: { householdId: session.householdId } } },
    data: { notes: notes || null },
  });

  revalidatePath(`/transactions/${transactionId}`);
}

/**
 * Screenshot-import dedupe review (packages/ledger/src/screenshotDedupe.ts):
 * the household confirms this transaction is genuinely separate from the
 * one it was flagged as a possible duplicate of — just clears the flag,
 * both rows stay exactly as they are.
 */
export async function keepAsSeparateTransaction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const transactionId = String(formData.get("transactionId"));

  await prisma.transaction.updateMany({
    where: { id: transactionId, account: { connection: { householdId: session.householdId } } },
    data: { possibleDuplicateOfId: null },
  });

  await recordAuditEvent({
    householdId: session.householdId,
    actorUserId: session.userId,
    action: "CONFIRM_NOT_DUPLICATE",
    entityType: "Transaction",
    entityId: transactionId,
  });

  revalidatePath(`/transactions/${transactionId}`);
  revalidatePath("/transactions");
}

/**
 * The household confirms this transaction IS the same real-world spend as
 * the one it was flagged against — deletes this (the flagged, newer) row
 * rather than the one it possibly duplicates, since the flagged row is
 * always the one screenshot-import was unsure about adding.
 */
export async function markAsDuplicateTransaction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const transactionId = String(formData.get("transactionId"));

  const transaction = await prisma.transaction.findFirst({
    where: { id: transactionId, account: { connection: { householdId: session.householdId } }, possibleDuplicateOfId: { not: null } },
    select: { id: true, possibleDuplicateOfId: true },
  });
  if (!transaction) {
    revalidatePath("/transactions");
    return;
  }

  await prisma.transaction.delete({ where: { id: transaction.id } });

  await recordAuditEvent({
    householdId: session.householdId,
    actorUserId: session.userId,
    action: "CONFIRM_DUPLICATE_REMOVED",
    entityType: "Transaction",
    entityId: transaction.id,
    metadata: { keptTransactionId: transaction.possibleDuplicateOfId },
  });

  revalidatePath("/transactions");
  revalidatePath("/");
  redirect("/transactions");
}

/**
 * Screenshot-import extraction-uncertainty review
 * (packages/ai/src/screenshotExtraction.ts): the household confirms this
 * transaction's details (date/description/amount) look correct despite the
 * vision model's low confidence — just clears the flag, the row itself is
 * never altered (no data was ever fabricated to begin with, so there is
 * nothing to "fix", only to confirm).
 */
/**
 * Financial-movement review (packages/ledger/src/financialMovementDetection.ts,
 * categorisation closure pass §2/§5): the household confirms this is
 * genuine spending, not an internal movement — just clears the flag,
 * categoryId is left exactly as it was (null, if nothing deterministic
 * resolved it) so the transaction proceeds through ordinary categorisation
 * review via the Reclassify form above, same as any other uncategorized
 * transaction.
 */
export async function confirmAsGenuineSpending(formData: FormData): Promise<void> {
  const session = await requireSession();
  const transactionId = String(formData.get("transactionId"));

  await prisma.transaction.updateMany({
    where: { id: transactionId, account: { connection: { householdId: session.householdId } } },
    data: { needsFinancialMovementReview: false },
  });

  await recordAuditEvent({
    householdId: session.householdId,
    actorUserId: session.userId,
    action: "CONFIRM_GENUINE_SPENDING",
    entityType: "Transaction",
    entityId: transactionId,
  });

  revalidatePath(`/transactions/${transactionId}`);
  revalidatePath("/transactions");
}

export async function clearExtractionReview(formData: FormData): Promise<void> {
  const session = await requireSession();
  const transactionId = String(formData.get("transactionId"));

  await prisma.transaction.updateMany({
    where: { id: transactionId, account: { connection: { householdId: session.householdId } } },
    data: { needsExtractionReview: false },
  });

  await recordAuditEvent({
    householdId: session.householdId,
    actorUserId: session.userId,
    action: "CONFIRM_EXTRACTION_CORRECT",
    entityType: "Transaction",
    entityId: transactionId,
  });

  revalidatePath(`/transactions/${transactionId}`);
  revalidatePath("/transactions");
}
