import { describe, expect, it } from "vitest";
import { toMoney } from "@frodocodo/shared";
import { detectTransferPairs, type TransferCandidate } from "../transferDetection.js";

describe("detectTransferPairs", () => {
  it("identifies a credit-card repayment as a transfer, not spending (§38)", () => {
    const candidates: TransferCandidate[] = [
      { id: "debit_1", accountId: "cba_transaction", accountType: "TRANSACTION", amount: toMoney(500), direction: "DEBIT", transactionDate: "2026-08-14" },
      { id: "credit_1", accountId: "virgin_cc", accountType: "CREDIT_CARD", amount: toMoney(500), direction: "CREDIT", transactionDate: "2026-08-15" },
      // Unrelated real spending that should NOT be swept into the match.
      { id: "debit_2", accountId: "virgin_cc", accountType: "CREDIT_CARD", amount: toMoney(45), direction: "DEBIT", transactionDate: "2026-08-14" },
    ];

    const matches = detectTransferPairs(candidates);
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({
      debitTransactionId: "debit_1",
      creditTransactionId: "credit_1",
      kind: "CREDIT_CARD_REPAYMENT",
    });
  });

  it("identifies a plain inter-account transfer (e.g. to savings)", () => {
    const candidates: TransferCandidate[] = [
      { id: "debit_1", accountId: "cba_transaction", accountType: "TRANSACTION", amount: toMoney(1000), direction: "DEBIT", transactionDate: "2026-08-01" },
      { id: "credit_1", accountId: "cba_savings", accountType: "SAVINGS", amount: toMoney(1000), direction: "CREDIT", transactionDate: "2026-08-01" },
    ];

    const matches = detectTransferPairs(candidates);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.kind).toBe("INTER_ACCOUNT_TRANSFER");
  });

  it("does not match a debit and credit on the same account against each other", () => {
    const candidates: TransferCandidate[] = [
      { id: "debit_1", accountId: "cba_transaction", accountType: "TRANSACTION", amount: toMoney(200), direction: "DEBIT", transactionDate: "2026-08-01" },
      { id: "credit_1", accountId: "cba_transaction", accountType: "TRANSACTION", amount: toMoney(200), direction: "CREDIT", transactionDate: "2026-08-01" },
    ];
    expect(detectTransferPairs(candidates)).toHaveLength(0);
  });

  it("does not match amounts outside the date window", () => {
    const candidates: TransferCandidate[] = [
      { id: "debit_1", accountId: "cba_transaction", accountType: "TRANSACTION", amount: toMoney(500), direction: "DEBIT", transactionDate: "2026-08-01" },
      { id: "credit_1", accountId: "virgin_cc", accountType: "CREDIT_CARD", amount: toMoney(500), direction: "CREDIT", transactionDate: "2026-08-20" },
    ];
    expect(detectTransferPairs(candidates)).toHaveLength(0);
  });

  it("does not double-match a credit against multiple debits of the same amount", () => {
    const candidates: TransferCandidate[] = [
      { id: "debit_1", accountId: "cba_transaction", accountType: "TRANSACTION", amount: toMoney(300), direction: "DEBIT", transactionDate: "2026-08-01" },
      { id: "debit_2", accountId: "cba_transaction", accountType: "TRANSACTION", amount: toMoney(300), direction: "DEBIT", transactionDate: "2026-08-02" },
      { id: "credit_1", accountId: "virgin_cc", accountType: "CREDIT_CARD", amount: toMoney(300), direction: "CREDIT", transactionDate: "2026-08-02" },
    ];
    const matches = detectTransferPairs(candidates);
    expect(matches).toHaveLength(1);
    const usedCreditIds = new Set(matches.map((m) => m.creditTransactionId));
    expect(usedCreditIds.size).toBe(1);
  });
});
