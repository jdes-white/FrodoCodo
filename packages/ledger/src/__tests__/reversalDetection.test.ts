import { describe, expect, it } from "vitest";
import { toMoney } from "@frodocodo/shared";
import { detectReversals, type ReversalCandidate } from "../reversalDetection.js";

describe("detectReversals (Task 6C hardened tiers)", () => {
  describe("Tier 1: provider-supplied linkage", () => {
    it("matches when a source explicitly declares the reversal linkage, trusting it directly", () => {
      const candidates: ReversalCandidate[] = [
        { id: "purchase_1", accountId: "amex_cc", providerTransactionId: "ptx_1", amount: toMoney(85.5), direction: "DEBIT", transactionDate: "2026-08-10" },
        {
          id: "reversal_1",
          accountId: "amex_cc",
          providerTransactionId: "ptx_2",
          amount: toMoney(85.5),
          direction: "CREDIT",
          transactionDate: "2026-08-11",
          reversalOfProviderTransactionId: "ptx_1",
        },
      ];

      const matches = detectReversals(candidates);
      expect(matches).toHaveLength(1);
      expect(matches[0]).toMatchObject({ originalTransactionId: "purchase_1", reversalTransactionId: "reversal_1", evidence: "PROVIDER_LINKED" });
    });

    it("trusts the provider link even outside the tight window or with no keyword evidence", () => {
      const candidates: ReversalCandidate[] = [
        { id: "purchase_1", accountId: "amex_cc", providerTransactionId: "ptx_1", amount: toMoney(60), direction: "DEBIT", transactionDate: "2026-08-01" },
        {
          id: "reversal_1",
          accountId: "amex_cc",
          providerTransactionId: "ptx_2",
          amount: toMoney(60),
          direction: "CREDIT",
          transactionDate: "2026-08-20", // 19 days later -- would fail tier 2's window
          description: "ADJUSTMENT", // no reversal keyword
          reversalOfProviderTransactionId: "ptx_1",
        },
      ];
      const matches = detectReversals(candidates);
      expect(matches).toHaveLength(1);
      expect(matches[0]!.evidence).toBe("PROVIDER_LINKED");
    });

    it("does not trust a provider link pointing at a transaction in the same direction (sanity check)", () => {
      const candidates: ReversalCandidate[] = [
        { id: "debit_1", accountId: "amex_cc", providerTransactionId: "ptx_1", amount: toMoney(60), direction: "DEBIT", transactionDate: "2026-08-01" },
        {
          id: "debit_2",
          accountId: "amex_cc",
          providerTransactionId: "ptx_2",
          amount: toMoney(60),
          direction: "DEBIT",
          transactionDate: "2026-08-02",
          reversalOfProviderTransactionId: "ptx_1",
        },
      ];
      expect(detectReversals(candidates)).toHaveLength(0);
    });

    it("does not trust a link that points at an unknown providerTransactionId", () => {
      const candidates: ReversalCandidate[] = [
        {
          id: "reversal_1",
          accountId: "amex_cc",
          providerTransactionId: "ptx_2",
          amount: toMoney(60),
          direction: "CREDIT",
          transactionDate: "2026-08-11",
          reversalOfProviderTransactionId: "ptx_does_not_exist",
        },
      ];
      expect(detectReversals(candidates)).toHaveLength(0);
    });
  });

  describe("Tier 2: exact amount/window + deterministic keyword evidence", () => {
    it("matches when the reversal-side description carries an explicit reversal keyword", () => {
      const candidates: ReversalCandidate[] = [
        { id: "purchase_1", accountId: "amex_cc", providerTransactionId: null, amount: toMoney(40), direction: "DEBIT", transactionDate: "2026-08-10", description: "COLES 0092" },
        { id: "reversal_1", accountId: "amex_cc", providerTransactionId: null, amount: toMoney(40), direction: "CREDIT", transactionDate: "2026-08-11", description: "TRANSACTION REVERSAL" },
      ];
      const matches = detectReversals(candidates);
      expect(matches).toHaveLength(1);
      expect(matches[0]).toMatchObject({ originalTransactionId: "purchase_1", reversalTransactionId: "reversal_1", evidence: "REVERSAL_KEYWORD" });
    });

    it.each(["DECLINED", "VOID", "VOIDED", "CANCELLED", "CANCELED", "REVERSED"])(
      "recognizes the keyword %s",
      (keyword) => {
        const candidates: ReversalCandidate[] = [
          { id: "purchase_1", accountId: "amex_cc", providerTransactionId: null, amount: toMoney(25), direction: "DEBIT", transactionDate: "2026-08-10" },
          { id: "reversal_1", accountId: "amex_cc", providerTransactionId: null, amount: toMoney(25), direction: "CREDIT", transactionDate: "2026-08-10", description: `POS ${keyword}` },
        ];
        expect(detectReversals(candidates)).toHaveLength(1);
      },
    );

    it("does not match same-day pairs without keyword evidence, even with matching amount/direction/window", () => {
      const candidates: ReversalCandidate[] = [
        { id: "purchase_1", accountId: "amex_cc", providerTransactionId: null, amount: toMoney(40), direction: "DEBIT", transactionDate: "2026-08-10", description: "COLES 0092" },
        { id: "credit_1", accountId: "amex_cc", providerTransactionId: null, amount: toMoney(40), direction: "CREDIT", transactionDate: "2026-08-10", description: "REFUND ADJUSTMENT" },
      ];
      expect(detectReversals(candidates)).toHaveLength(0);
    });
  });

  describe("Hardening: unrelated equal-and-opposite transactions must NOT be netted", () => {
    it("does not match two unrelated transactions that merely share an amount within the 2-day window (the core false-positive risk)", () => {
      const candidates: ReversalCandidate[] = [
        // A genuine $85 fuel purchase...
        { id: "fuel_purchase", accountId: "amex_cc", providerTransactionId: "ptx_10", amount: toMoney(85), direction: "DEBIT", transactionDate: "2026-08-10", description: "BP BRISBANE AU" },
        // ...and a completely unrelated $85 refund from something else, one day later, purely coincidental.
        { id: "unrelated_refund", accountId: "amex_cc", providerTransactionId: "ptx_11", amount: toMoney(85), direction: "CREDIT", transactionDate: "2026-08-11", description: "REFUND KMART BRISBANE AU" },
      ];

      // Before Task 6C's hardening, plain amount+window matching would
      // have netted these to zero, silently erasing the real fuel
      // purchase from the household's spending. It must not.
      expect(detectReversals(candidates)).toHaveLength(0);
    });

    it("does not match same-day unrelated equal-and-opposite transactions on the same account", () => {
      const candidates: ReversalCandidate[] = [
        { id: "purchase_1", accountId: "cba_transaction", providerTransactionId: "ptx_20", amount: toMoney(50), direction: "DEBIT", transactionDate: "2026-08-10", description: "CLEANER SERVICES" },
        { id: "credit_1", accountId: "cba_transaction", providerTransactionId: "ptx_21", amount: toMoney(50), direction: "CREDIT", transactionDate: "2026-08-10", description: "SALARY ADJUSTMENT" },
      ];
      expect(detectReversals(candidates)).toHaveLength(0);
    });

    it("does not match across different accounts (that's a transfer's job, not a reversal's)", () => {
      const candidates: ReversalCandidate[] = [
        { id: "debit_1", accountId: "cba_transaction", providerTransactionId: null, amount: toMoney(500), direction: "DEBIT", transactionDate: "2026-08-10", description: "PAYMENT TO CARD" },
        { id: "credit_1", accountId: "virgin_cc", providerTransactionId: null, amount: toMoney(500), direction: "CREDIT", transactionDate: "2026-08-11", description: "PAYMENT RECEIVED REVERSAL" },
      ];
      expect(detectReversals(candidates)).toHaveLength(0);
    });

    it("does not match beyond the window even with keyword evidence present", () => {
      const candidates: ReversalCandidate[] = [
        { id: "purchase_1", accountId: "amex_cc", providerTransactionId: null, amount: toMoney(60), direction: "DEBIT", transactionDate: "2026-08-01" },
        { id: "credit_1", accountId: "amex_cc", providerTransactionId: null, amount: toMoney(60), direction: "CREDIT", transactionDate: "2026-08-10", description: "TRANSACTION REVERSAL" },
      ];
      // 9 days apart -- outside the tight reversal window.
      expect(detectReversals(candidates)).toHaveLength(0);
    });

    it("does not match a debit and credit of different amounts even with keyword evidence", () => {
      const candidates: ReversalCandidate[] = [
        { id: "purchase_1", accountId: "amex_cc", providerTransactionId: null, amount: toMoney(60), direction: "DEBIT", transactionDate: "2026-08-10" },
        { id: "credit_1", accountId: "amex_cc", providerTransactionId: null, amount: toMoney(45), direction: "CREDIT", transactionDate: "2026-08-11", description: "REVERSAL" },
      ];
      expect(detectReversals(candidates)).toHaveLength(0);
    });

    it("avoids double-counting: a third, unrelated same-amount transaction is not swept into a genuine keyword-evidenced pair", () => {
      const candidates: ReversalCandidate[] = [
        { id: "purchase_1", accountId: "amex_cc", providerTransactionId: null, amount: toMoney(50), direction: "DEBIT", transactionDate: "2026-08-10" },
        { id: "reversal_1", accountId: "amex_cc", providerTransactionId: null, amount: toMoney(50), direction: "CREDIT", transactionDate: "2026-08-11", description: "DECLINED" },
        { id: "purchase_2", accountId: "amex_cc", providerTransactionId: null, amount: toMoney(50), direction: "DEBIT", transactionDate: "2026-08-12", description: "UNRELATED GENUINE SPEND" },
      ];
      const matches = detectReversals(candidates);
      expect(matches).toHaveLength(1);
      expect(matches[0]!.originalTransactionId).toBe("purchase_1");
      expect(matches.some((m) => m.originalTransactionId === "purchase_2" || m.reversalTransactionId === "purchase_2")).toBe(false);
    });
  });
});
