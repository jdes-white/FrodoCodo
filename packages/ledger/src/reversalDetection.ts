import type { TransactionDirection } from "@frodocodo/shared";
import { toMoney, type MoneyInput } from "@frodocodo/shared";

/**
 * Task 6A's specific gap: a same-account, equal-and-opposite reversal of a
 * card transaction (e.g. a purchase that's declined/reversed by the
 * merchant's own terminal, or a bank-initiated reversal) is neither a
 * cross-account transfer (transferDetection.ts requires two different
 * accounts) nor a merchant-matched refund (refundMatching.ts requires the
 * same normalized merchant and allows a much wider window, since a refund
 * is typically days-to-weeks after the original purchase and a reversal's
 * description often does NOT match the original merchant's — a bank's own
 * reversal message is generic, not a repeat of the merchant string).
 *
 * Reversal matching is deliberately narrower and more exact than either:
 * same account, exactly equal magnitude, opposite direction, and a tight
 * date window (reversals post within a day or two of the original attempt
 * in practice) — no merchant/description signal required. This keeps the
 * match deterministic and avoids the false-positive risk of "any two
 * equal-and-opposite amounts within N days on the same account must be a
 * reversal," which could silently net out two genuinely independent
 * transactions that happen to share an amount (see CLAUDE.md's "never
 * double-count" principle read in the direction that also means "never
 * silently un-count a real purchase").
 *
 * Only ever called with transactions already excluded from transfer
 * matching (a transaction can be at most one of: transfer leg, reversal
 * leg, refund leg) — see apps/worker/src/syncConnection.ts and
 * packages/db/src/seedHousehold.ts for the reconciliation order.
 */
export interface ReversalCandidate {
  id: string;
  accountId: string;
  amount: MoneyInput; // positive magnitude
  direction: TransactionDirection;
  transactionDate: string; // YYYY-MM-DD
}

export interface ReversalMatch {
  /** The earlier transaction that got reversed. */
  originalTransactionId: string;
  /** The later, equal-and-opposite transaction that reverses it. */
  reversalTransactionId: string;
}

const REVERSAL_MATCH_WINDOW_DAYS = 2;

export function detectReversals(candidates: ReversalCandidate[]): ReversalMatch[] {
  const byAccount = new Map<string, ReversalCandidate[]>();
  for (const candidate of candidates) {
    const bucket = byAccount.get(candidate.accountId);
    if (bucket) bucket.push(candidate);
    else byAccount.set(candidate.accountId, [candidate]);
  }

  const usedIds = new Set<string>();
  const matches: ReversalMatch[] = [];

  for (const accountCandidates of byAccount.values()) {
    const sorted = [...accountCandidates].sort((a, b) => a.transactionDate.localeCompare(b.transactionDate));

    for (let i = 0; i < sorted.length; i++) {
      const original = sorted[i]!;
      if (usedIds.has(original.id)) continue;

      let best: ReversalCandidate | null = null;
      let bestDistance = Infinity;

      for (let j = i + 1; j < sorted.length; j++) {
        const candidate = sorted[j]!;
        if (usedIds.has(candidate.id)) continue;
        if (candidate.direction === original.direction) continue; // must be opposite
        if (!toMoney(candidate.amount).equals(toMoney(original.amount))) continue;

        const distance = daysBetween(original.transactionDate, candidate.transactionDate);
        if (distance < 0) continue; // reversal must not precede the original
        if (distance <= REVERSAL_MATCH_WINDOW_DAYS && distance < bestDistance) {
          best = candidate;
          bestDistance = distance;
        }
      }

      if (best) {
        usedIds.add(original.id);
        usedIds.add(best.id);
        matches.push({ originalTransactionId: original.id, reversalTransactionId: best.id });
      }
    }
  }

  return matches;
}

function daysBetween(a: string, b: string): number {
  return (Date.parse(b) - Date.parse(a)) / 86_400_000;
}
