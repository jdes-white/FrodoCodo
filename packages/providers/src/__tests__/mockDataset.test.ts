import { describe, expect, it } from "vitest";
import { generateHouseholdDataset, MOCK_ACCOUNT_IDS } from "../mockDataset.js";

describe("generateHouseholdDataset", () => {
  const dataset = generateHouseholdDataset({ asOfDate: "2026-08-14", monthsOfHistory: 4, seed: 7 });

  it("is deterministic for a given seed", () => {
    const again = generateHouseholdDataset({ asOfDate: "2026-08-14", monthsOfHistory: 4, seed: 7 });
    expect(again.transactions.length).toBe(dataset.transactions.length);
    expect(again.transactions.map((t) => t.providerTransactionId)).toEqual(
      dataset.transactions.map((t) => t.providerTransactionId),
    );
  });

  it("produces the three target accounts", () => {
    const ids = dataset.accounts.map((a) => a.providerAccountId).sort();
    expect(ids).toEqual(
      [MOCK_ACCOUNT_IDS.amexCreditCard, MOCK_ACCOUNT_IDS.cbaTransaction, MOCK_ACCOUNT_IDS.virginCreditCard].sort(),
    );
  });

  it("every transaction amount is a positive magnitude", () => {
    for (const t of dataset.transactions) {
      expect(t.amount.isNegative()).toBe(false);
    }
  });

  it("includes recurring salary income, fixed commitments, and subscriptions", () => {
    expect(dataset.transactions.some((t) => /SALARY/i.test(t.description))).toBe(true);
    expect(dataset.transactions.some((t) => /HOME LOAN/i.test(t.description))).toBe(true);
    expect(dataset.transactions.some((t) => /NETFLIX/i.test(t.description))).toBe(true);
  });

  it("includes credit-card repayment transfer pairs (§38)", () => {
    const repaymentOut = dataset.transactions.find((t) => /PAYMENT TO VIRGIN MONEY/i.test(t.description));
    const repaymentIn = dataset.transactions.filter((t) => /PAYMENT RECEIVED/i.test(t.description));
    expect(repaymentOut).toBeDefined();
    expect(repaymentIn.length).toBeGreaterThan(0);
  });

  it("includes at least one refund credit (§39)", () => {
    expect(dataset.transactions.some((t) => /^REFUND/i.test(t.description))).toBe(true);
  });

  it("marks only very recent card spend as pending, never bank-account debits", () => {
    const pending = dataset.transactions.filter((t) => t.status === "PENDING");
    expect(pending.length).toBeGreaterThan(0);
    for (const t of pending) {
      expect(t.accountProviderId).not.toBe(MOCK_ACCOUNT_IDS.cbaTransaction);
    }
  });

  it("includes deliberately ambiguous merchant descriptions for the review queue", () => {
    expect(dataset.transactions.some((t) => /^(SP \*|PAYPAL \*|SQ \*)/.test(t.description))).toBe(true);
  });

  it("assigns a unique providerTransactionId to every transaction", () => {
    const ids = dataset.transactions.map((t) => t.providerTransactionId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
