import "server-only";
import { cache } from "react";
import { prisma } from "@frodocodo/db";

/**
 * The app shell layout ((app)/layout.tsx) and every primary page's own
 * data-fetching (getBudgetSnapshot) each independently fetched this same
 * household row — two DB round-trips per navigation for identical data.
 * `cache()` (React's request-scoped memoization, the standard Next.js App
 * Router pattern for this) dedupes calls with the same householdId within
 * a single render pass, so both call sites now share one query.
 */
export const getHousehold = cache(async (householdId: string) => {
  return prisma.household.findUniqueOrThrow({ where: { id: householdId } });
});
