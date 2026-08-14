import type { TransactionDirection, TransactionStatus } from "@frodocodo/shared";
import { toMoney, type Money } from "@frodocodo/shared";

/**
 * A transaction as reported by a provider sync, before it's written to the
 * ledger. Framework/DB-independent so this logic is unit-testable without a
 * database (§10, §40: pending/posted correctness is non-negotiable).
 */
export interface CandidateTransaction {
  accountId: string;
  providerTransactionId: string | null;
  transactionDate: string; // YYYY-MM-DD
  amount: Money;
  direction: TransactionDirection;
  status: TransactionStatus;
  originalDescription: string;
}

export interface ExistingTransactionRef {
  id: string;
  accountId: string;
  providerTransactionId: string | null;
  transactionDate: string;
  amount: Money;
  direction: TransactionDirection;
  status: TransactionStatus;
}

export type DedupeDecision =
  | { action: "INSERT" }
  | { action: "UPDATE_STATUS_TO_POSTED"; existingId: string; matchedBy: "providerId" | "heuristic" }
  | { action: "SKIP_DUPLICATE"; existingId: string };

const PENDING_TO_POSTED_MATCH_WINDOW_DAYS = 5;

/**
 * Decide what a newly-synced candidate transaction means relative to what's
 * already in the ledger for this account. Never inserts a second row for a
 * transaction that already exists, and never double-counts a pending
 * transaction once it posts.
 */
export function resolveDedupe(
  candidate: CandidateTransaction,
  existingCandidates: ExistingTransactionRef[],
): DedupeDecision {
  if (candidate.providerTransactionId) {
    const exactMatch = existingCandidates.find(
      (existing) =>
        existing.accountId === candidate.accountId &&
        existing.providerTransactionId === candidate.providerTransactionId,
    );
    if (exactMatch) {
      if (exactMatch.status === "PENDING" && candidate.status === "POSTED") {
        return { action: "UPDATE_STATUS_TO_POSTED", existingId: exactMatch.id, matchedBy: "providerId" };
      }
      return { action: "SKIP_DUPLICATE", existingId: exactMatch.id };
    }
  }

  // Some providers reissue a new transaction ID when a pending transaction
  // posts. Fall back to a same-account/amount/direction match within a
  // short date window rather than inserting a duplicate.
  if (candidate.status === "POSTED") {
    const heuristicMatch = existingCandidates.find(
      (existing) =>
        existing.accountId === candidate.accountId &&
        existing.status === "PENDING" &&
        existing.direction === candidate.direction &&
        toMoney(existing.amount).equals(toMoney(candidate.amount)) &&
        Math.abs(daysBetweenLoose(existing.transactionDate, candidate.transactionDate)) <=
          PENDING_TO_POSTED_MATCH_WINDOW_DAYS,
    );
    if (heuristicMatch) {
      return { action: "UPDATE_STATUS_TO_POSTED", existingId: heuristicMatch.id, matchedBy: "heuristic" };
    }
  }

  return { action: "INSERT" };
}

function daysBetweenLoose(a: string, b: string): number {
  return (Date.parse(b) - Date.parse(a)) / 86_400_000;
}
