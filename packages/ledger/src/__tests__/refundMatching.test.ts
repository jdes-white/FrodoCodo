import { describe, expect, it } from "vitest";
import { toMoney } from "@frodocodo/shared";
import { detectRefunds, type RefundCandidate } from "../refundMatching.js";

describe("detectRefunds", () => {
  it("links a full refund back to its original purchase (§39)", () => {
    const candidates: RefundCandidate[] = [
      { id: "purchase_1", accountId: "virgin_cc", merchantMatchKey: "jbhifi", amount: toMoney(199), direction: "DEBIT", transactionDate: "2026-07-20" },
      { id: "refund_1", accountId: "virgin_cc", merchantMatchKey: "jbhifi", amount: toMoney(199), direction: "CREDIT", transactionDate: "2026-07-25" },
    ];
    const matches = detectRefunds(candidates);
    expect(matches).toEqual([{ refundTransactionId: "refund_1", originalTransactionId: "purchase_1" }]);
  });

  it("links a partial refund to the original purchase", () => {
    const candidates: RefundCandidate[] = [
      { id: "purchase_1", accountId: "virgin_cc", merchantMatchKey: "amazon", amount: toMoney(150), direction: "DEBIT", transactionDate: "2026-07-01" },
      { id: "refund_1", accountId: "virgin_cc", merchantMatchKey: "amazon", amount: toMoney(60), direction: "CREDIT", transactionDate: "2026-07-10" },
    ];
    const matches = detectRefunds(candidates);
    expect(matches).toEqual([{ refundTransactionId: "refund_1", originalTransactionId: "purchase_1" }]);
  });

  it("does not match a refund to a purchase at a different merchant", () => {
    const candidates: RefundCandidate[] = [
      { id: "purchase_1", accountId: "virgin_cc", merchantMatchKey: "woolworths", amount: toMoney(80), direction: "DEBIT", transactionDate: "2026-07-01" },
      { id: "refund_1", accountId: "virgin_cc", merchantMatchKey: "target", amount: toMoney(80), direction: "CREDIT", transactionDate: "2026-07-05" },
    ];
    expect(detectRefunds(candidates)).toHaveLength(0);
  });

  it("does not match a credit that precedes its supposed original purchase", () => {
    const candidates: RefundCandidate[] = [
      { id: "credit_1", accountId: "virgin_cc", merchantMatchKey: "kmart", amount: toMoney(40), direction: "CREDIT", transactionDate: "2026-07-01" },
      { id: "purchase_1", accountId: "virgin_cc", merchantMatchKey: "kmart", amount: toMoney(40), direction: "DEBIT", transactionDate: "2026-07-10" },
    ];
    expect(detectRefunds(candidates)).toHaveLength(0);
  });

  it("does not treat a refund larger than any prior purchase as a match", () => {
    const candidates: RefundCandidate[] = [
      { id: "purchase_1", accountId: "virgin_cc", merchantMatchKey: "bunnings", amount: toMoney(30), direction: "DEBIT", transactionDate: "2026-07-01" },
      { id: "refund_1", accountId: "virgin_cc", merchantMatchKey: "bunnings", amount: toMoney(90), direction: "CREDIT", transactionDate: "2026-07-05" },
    ];
    expect(detectRefunds(candidates)).toHaveLength(0);
  });
});
