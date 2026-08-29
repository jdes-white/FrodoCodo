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
  const where: Prisma.TransactionWhereInput = {
    account: { connection: { householdId } },
  };

  if (filters.bucketId) where.category = { bucketId: filters.bucketId };
  if (filters.categoryId) where.categoryId = filters.categoryId;
  if (filters.accountId) where.accountId = filters.accountId;
  if (filters.merchantQuery) {
    where.OR = [
      { originalDescription: { contains: filters.merchantQuery, mode: "insensitive" } },
      { merchant: { normalizedName: { contains: filters.merchantQuery, mode: "insensitive" } } },
    ];
  }
  if (filters.needsReviewOnly) where.categoryId = null;
  if (filters.reviewedOnly) where.categoryId = { not: null };
  if (!filters.includeExcluded) where.isExcludedFromBudget = false;
  if (filters.startDate || filters.endDate) {
    where.transactionDate = {
      ...(filters.startDate ? { gte: new Date(filters.startDate) } : {}),
      ...(filters.endDate ? { lte: new Date(filters.endDate) } : {}),
    };
  }

  return prisma.transaction.findMany({
    where,
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
    },
  });
}

export async function listReviewQueue(householdId: string) {
  return listTransactions(householdId, { needsReviewOnly: true, limit: 100 });
}
