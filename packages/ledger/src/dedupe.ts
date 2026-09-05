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
 *
 * Source-agnostic by construction (Task 6B): every field this function
 * reads — accountId, providerTransactionId, date, amount, direction,
 * status — is something any ingestion source can supply (a live
 * provider sync, a future CSV import, a future screenshot import), via
 * `packages/ledger/src/ingestion.ts`'s normalized shape. No source-specific
 * branching exists or should be added here.
 *
 * Where exact matching ends today, deliberately: the providerTransactionId
 * exact-match path and the pending→posted heuristic (below) both require
 * an *existing* row to reconcile against, and the heuristic only matches
 * against an existing row that is still PENDING. Two different sources
 * both reporting the same real-world transaction as already POSTED — e.g.
 * a future CSV import of a transaction a live CDR sync already landed —
 * is NOT resolved by this function, on purpose: without a shared stable ID
 * or a merchant/description signal, collapsing two POSTED, same-account,
 * same-amount, same-direction, same-day rows risks silently discarding a
 * genuine second purchase that happens to match by coincidence (rent-
 * splitting, two identical grocery runs, etc.) — exactly the failure mode
 * the task's reversal/transfer logic is careful to avoid elsewhere. Closing
 * this gap safely needs either a real shared stable key across sources (the
 * strong fix) or a household-facing "possible duplicate — confirm" review
 * step (matching the existing "always classify this way" / MerchantRule
 * pattern of never silently overriding without the option to correct) —
 * both are future work, not attempted here; see
 * docs/banking-data-minimisation-audit.md and the Task 6B report for the
 * full reasoning. Fuzzy/AI-based matching is explicitly out of scope.
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
