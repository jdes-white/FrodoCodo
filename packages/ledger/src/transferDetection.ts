import type { AccountType, TransactionDirection } from "@frodocodo/shared";
import { toMoney, type Money, type MoneyInput } from "@frodocodo/shared";

/**
 * §38: a credit-card purchase is spending; the later payment from the bank
 * account to the credit card is a transfer/settlement, not additional
 * spending. This also catches plain inter-account transfers (e.g. moving
 * money to a savings account). Both must be excluded from budget totals or
 * the household's spend gets double-counted.
 *
 * Only ever called with transactions from the household's OWN accounts —
 * an external merchant charge has no "other leg" in this candidate set, so
 * the amount+window heuristic stays safe in practice. Users can always
 * override a false match (§32).
 */
export interface TransferCandidate {
  id: string;
  accountId: string;
  accountType: AccountType;
  amount: MoneyInput; // positive magnitude
  direction: TransactionDirection;
  transactionDate: string; // YYYY-MM-DD
}

export type TransferKind = "CREDIT_CARD_REPAYMENT" | "INTER_ACCOUNT_TRANSFER";

export interface TransferMatch {
  debitTransactionId: string;
  creditTransactionId: string;
  kind: TransferKind;
  amount: Money;
}

const MATCH_WINDOW_DAYS = 3;

export function detectTransferPairs(candidates: TransferCandidate[]): TransferMatch[] {
  const debits = candidates
    .filter((c) => c.direction === "DEBIT")
    .sort((a, b) => a.transactionDate.localeCompare(b.transactionDate));
  const credits = candidates.filter((c) => c.direction === "CREDIT");

  const usedCreditIds = new Set<string>();
  const matches: TransferMatch[] = [];

  for (const debit of debits) {
    let best: TransferCandidate | null = null;
    let bestDistance = Infinity;

    for (const credit of credits) {
      if (usedCreditIds.has(credit.id)) continue;
      if (credit.accountId === debit.accountId) continue; // a transfer always crosses accounts
      if (!toMoney(credit.amount).equals(toMoney(debit.amount))) continue;

      const distance = Math.abs(daysBetween(debit.transactionDate, credit.transactionDate));
      if (distance <= MATCH_WINDOW_DAYS && distance < bestDistance) {
        best = credit;
        bestDistance = distance;
      }
    }

    if (best) {
      usedCreditIds.add(best.id);
      matches.push({
        debitTransactionId: debit.id,
        creditTransactionId: best.id,
        kind: best.accountType === "CREDIT_CARD" ? "CREDIT_CARD_REPAYMENT" : "INTER_ACCOUNT_TRANSFER",
        amount: toMoney(debit.amount),
      });
    }
  }

  return matches;
}

function daysBetween(a: string, b: string): number {
  return (Date.parse(b) - Date.parse(a)) / 86_400_000;
}
