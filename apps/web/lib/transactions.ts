import "server-only";
import { prisma } from "@frodocodo/db";
import type { Prisma } from "@frodocodo/db";

export interface TransactionFilters {
  bucketId?: string;
  categoryId?: string;
  accountId?: string;
  merchantQuery?: string;
  reviewedOnly?: boolean;
  needsReviewOnly?: boolean;
  includeExcluded?: boolean;
  startDate?: string;
  endDate?: string;
  limit?: number;
}

export async function listTransactions(householdId: string, filters: TransactionFilters = {}) {
  // Built as an AND-array of independent conditions rather than mutating a
  // single `where` object, so `needsReviewOnly`'s own OR (uncategorized OR
  // flagged-possible-duplicate) can never collide with `merchantQuery`'s OR
  // — each filter contributes its own clause instead of overwriting a
  // shared `where.OR` field.
  const and: Prisma.TransactionWhereInput[] = [{ account: { connection: { householdId } } }];

  if (filters.bucketId) and.push({ category: { bucketId: filters.bucketId } });
  if (filters.categoryId) and.push({ categoryId: filters.categoryId });
  if (filters.accountId) and.push({ accountId: filters.accountId });
  if (filters.merchantQuery) {
    and.push({
      OR: [
        { originalDescription: { contains: filters.merchantQuery, mode: "insensitive" } },
        { merchant: { normalizedName: { contains: filters.merchantQuery, mode: "insensitive" } } },
      ],
    });
  }
  // "Needs review" now covers three independent reasons a transaction needs
  // household attention: uncategorized (the original meaning), flagged by
  // screenshot-import dedupe as a possible duplicate
  // (Transaction.possibleDuplicateOfId, packages/ledger/src/screenshotDedupe.ts),
  // or flagged by screenshot-import vision extraction as a low-confidence
  // read (Transaction.needsExtractionReview,
  // packages/ai/src/screenshotExtraction.ts) — reusing this existing review
  // queue rather than building a parallel one per reason.
  if (filters.needsReviewOnly) and.push({ OR: [{ categoryId: null }, { possibleDuplicateOfId: { not: null } }, { needsExtractionReview: true }] });
  if (filters.reviewedOnly) and.push({ categoryId: { not: null } });
  if (!filters.includeExcluded) and.push({ isExcludedFromBudget: false });
  if (filters.startDate || filters.endDate) {
    and.push({
      transactionDate: {
        ...(filters.startDate ? { gte: new Date(filters.startDate) } : {}),
        ...(filters.endDate ? { lte: new Date(filters.endDate) } : {}),
      },
    });
  }

  return prisma.transaction.findMany({
    where: { AND: and },
    include: {
      account: { include: { connection: { include: { institution: true } } } },
      merchant: true,
      category: { include: { bucket: true } },
    },
    orderBy: { transactionDate: "desc" },
    take: filters.limit ?? 50,
  });
}

export async function getTransactionDetail(householdId: string, transactionId: string) {
  return prisma.transaction.findFirst({
    where: { id: transactionId, account: { connection: { householdId } } },
    include: {
      account: { include: { connection: { include: { institution: true } } } },
      merchant: true,
      category: { include: { bucket: true } },
      suggestedCategory: { include: { bucket: true } },
      classifications: { orderBy: { createdAt: "desc" }, include: { createdBy: true } },
      // Screenshot-import dedupe review (packages/ledger/src/screenshotDedupe.ts)
      // — only populated when possibleDuplicateOfId is set.
      possibleDuplicateOf: {
        select: { id: true, transactionDate: true, amount: true, originalDescription: true, merchant: { select: { normalizedName: true } } },
      },
    },
  });
}

export async function listReviewQueue(householdId: string) {
  return listTransactions(householdId, { needsReviewOnly: true, limit: 100 });
}
