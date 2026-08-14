import "server-only";
import { prisma } from "@frodocodo/db";

export async function listCategoriesWithBuckets(householdId: string) {
  return prisma.category.findMany({
    where: { householdId, isArchived: false },
    include: { bucket: true },
    orderBy: [{ bucket: { sortOrder: "asc" } }, { sortOrder: "asc" }],
  });
}

export async function listAccounts(householdId: string) {
  return prisma.account.findMany({
    where: { connection: { householdId } },
    include: { connection: { include: { institution: true } } },
    orderBy: { displayName: "asc" },
  });
}
