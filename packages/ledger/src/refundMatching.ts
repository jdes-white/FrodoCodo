import type { TransactionDirection } from "@frodocodo/shared";
import { toMoney, type Money } from "@frodocodo/shared";

/**
 * §39: a refund should net against its original purchase's merchant/category
 * rather than appearing as unexplained new income. This only proposes a
 * link — it never merges the two rows, so both stay individually visible
 * and the user can correct an ambiguous match (§39, §32).
 */
export interface RefundCandidate {
  id: string;
  accountId: string;
  merchantMatchKey: string | null;
  amount: Money; // positive magnitude
  direction: TransactionDirection;
  transactionDate: string; // YYYY-MM-DD
}

export interface RefundMatch {
  refundTransactionId: string;
  originalTransactionId: string;
}

const REFUND_MATCH_WINDOW_DAYS = 90;

export function detectRefunds(candidates: RefundCandidate[]): RefundMatch[] {
  const credits = candidates
    .filter((c) => c.direction === "CREDIT" && c.merchantMatchKey)
    .sort((a, b) => a.transactionDate.localeCompare(b.transactionDate));
  const debits = candidates.filter((c) => c.direction === "DEBIT" && c.merchantMatchKey);

  const usedDebitIds = new Set<string>();
  const matches: RefundMatch[] = [];

  for (const credit of credits) {
    let best: RefundCandidate | null = null;
    let bestDistance = Infinity;

    for (const debit of debits) {
      if (usedDebitIds.has(debit.id)) continue;
      if (debit.accountId !== credit.accountId) continue;
      if (debit.merchantMatchKey !== credit.merchantMatchKey) continue;
      if (toMoney(debit.amount).lessThan(toMoney(credit.amount))) continue; // refund can't exceed original spend
      if (daysBetween(debit.transactionDate, credit.transactionDate) < 0) continue; // must precede the refund

      const distance = daysBetween(debit.transactionDate, credit.transactionDate);
      if (distance <= REFUND_MATCH_WINDOW_DAYS && distance < bestDistance) {
        best = debit;
        bestDistance = distance;
      }
    }

    if (best) {
      usedDebitIds.add(best.id);
      matches.push({ refundTransactionId: credit.id, originalTransactionId: best.id });
    }
  }

  return matches;
}

function daysBetween(a: string, b: string): number {
  return (Date.parse(b) - Date.parse(a)) / 86_400_000;
}
