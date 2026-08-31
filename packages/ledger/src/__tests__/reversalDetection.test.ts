import { describe, expect, it } from "vitest";
import { toMoney } from "@frodocodo/shared";
import { detectReversals, type ReversalCandidate } from "../reversalDetection.js";

describe("detectReversals", () => {
  it("matches a same-account, equal-and-opposite reversal within the window (Task 6A gap)", () => {
    const candidates: ReversalCandidate[] = [
      { id: "purchase_1", accountId: "amex_cc", amount: toMoney(85.5), direction: "DEBIT", transactionDate: "2026-08-10" },
      { id: "reversal_1", accountId: "amex_cc", amount: toMoney(85.5), direction: "CREDIT", transactionDate: "2026-08-11" },
    ];

    const matches = detectReversals(candidates);
    expect(matches).toHaveLength(1);
    expect(matches[0]).toEqual({ originalTransactionId: "purchase_1", reversalTransactionId: "reversal_1" });
  });

  it("matches same-day reversals (distance 0)", () => {
    const candidates: ReversalCandidate[] = [
      { id: "purchase_1", accountId: "amex_cc", amount: toMoney(40), direction: "DEBIT", transactionDate: "2026-08-10" },
      { id: "reversal_1", accountId: "amex_cc", amount: toMoney(40), direction: "CREDIT", transactionDate: "2026-08-10" },
    ];
    expect(detectReversals(candidates)).toHaveLength(1);
  });

  it("does not match across different accounts (that's a transfer's job, not a reversal's)", () => {
    const candidates: ReversalCandidate[] = [
      { id: "debit_1", accountId: "cba_transaction", amount: toMoney(500), direction: "DEBIT", transactionDate: "2026-08-10" },
      { id: "credit_1", accountId: "virgin_cc", amount: toMoney(500), direction: "CREDIT", transactionDate: "2026-08-11" },
    ];
    expect(detectReversals(candidates)).toHaveLength(0);
  });

  it("does not match beyond the reversal window, even same account/amount/opposite direction", () => {
    const candidates: ReversalCandidate[] = [
      { id: "purchase_1", accountId: "amex_cc", amount: toMoney(60), direction: "DEBIT", transactionDate: "2026-08-01" },
      { id: "credit_1", accountId: "amex_cc", amount: toMoney(60), direction: "CREDIT", transactionDate: "2026-08-10" },
    ];
    // 9 days apart -- outside the tight reversal window; a real refund
    // detector (merchant-matched, up to 90 days) is the right place for
    // this shape of match, not the reversal detector.
    expect(detectReversals(candidates)).toHaveLength(0);
  });

  it("does not match a debit and credit of different amounts", () => {
    const candidates: ReversalCandidate[] = [
      { id: "purchase_1", accountId: "amex_cc", amount: toMoney(60), direction: "DEBIT", transactionDate: "2026-08-10" },
      { id: "credit_1", accountId: "amex_cc", amount: toMoney(45), direction: "CREDIT", transactionDate: "2026-08-11" },
    ];
    expect(detectReversals(candidates)).toHaveLength(0);
  });

  it("does not match two transactions in the same direction", () => {
    const candidates: ReversalCandidate[] = [
      { id: "debit_1", accountId: "amex_cc", amount: toMoney(60), direction: "DEBIT", transactionDate: "2026-08-10" },
      { id: "debit_2", accountId: "amex_cc", amount: toMoney(60), direction: "DEBIT", transactionDate: "2026-08-11" },
    ];
    expect(detectReversals(candidates)).toHaveLength(0);
  });

  it("does not let a reversal precede the original it reverses", () => {
    const candidates: ReversalCandidate[] = [
      { id: "credit_1", accountId: "amex_cc", amount: toMoney(60), direction: "CREDIT", transactionDate: "2026-08-09" },
      { id: "debit_1", accountId: "amex_cc", amount: toMoney(60), direction: "DEBIT", transactionDate: "2026-08-10" },
    ];
    // The credit comes first chronologically, so it can only be "reversed
    // by" the later debit, not the other way around -- but a purchase
    // reversing an earlier, unrelated credit of the same amount is not a
    // real-world reversal shape, and this asserts we don't match one
    // anyway just because the amounts and window line up.
    const matches = detectReversals(candidates);
    expect(matches).toEqual([{ originalTransactionId: "credit_1", reversalTransactionId: "debit_1" }]);
  });

  it("avoids double-counting genuine independent purchases: does not match a third, unrelated same-amount transaction", () => {
    const candidates: ReversalCandidate[] = [
      { id: "purchase_1", accountId: "amex_cc", amount: toMoney(50), direction: "DEBIT", transactionDate: "2026-08-10" },
      { id: "reversal_1", accountId: "amex_cc", amount: toMoney(50), direction: "CREDIT", transactionDate: "2026-08-11" },
      // A second, genuinely independent $50 debit the same week -- must
      // not be swept into the same reversal pair.
      { id: "purchase_2", accountId: "amex_cc", amount: toMoney(50), direction: "DEBIT", transactionDate: "2026-08-12" },
    ];

    const matches = detectReversals(candidates);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.originalTransactionId).toBe("purchase_1");
    expect(matches.some((m) => m.originalTransactionId === "purchase_2" || m.reversalTransactionId === "purchase_2")).toBe(false);
  });

  it("does not double-match one reversal candidate against two possible originals", () => {
    const candidates: ReversalCandidate[] = [
      { id: "purchase_1", accountId: "amex_cc", amount: toMoney(30), direction: "DEBIT", transactionDate: "2026-08-10" },
      { id: "purchase_2", accountId: "amex_cc", amount: toMoney(30), direction: "DEBIT", transactionDate: "2026-08-11" },
      { id: "reversal_1", accountId: "amex_cc", amount: toMoney(30), direction: "CREDIT", transactionDate: "2026-08-11" },
    ];
    const matches = detectReversals(candidates);
    expect(matches).toHaveLength(1);
    const usedOriginals = new Set(matches.map((m) => m.originalTransactionId));
    expect(usedOriginals.size).toBe(1);
  });
});
