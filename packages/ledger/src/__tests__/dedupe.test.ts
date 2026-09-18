import { describe, expect, it } from "vitest";
import { toMoney } from "@frodocodo/shared";
import { resolveDedupe, type ExistingTransactionRef } from "../dedupe.js";

describe("resolveDedupe", () => {
  it("inserts a genuinely new transaction", () => {
    const decision = resolveDedupe(
      {
        accountId: "acc_1",
        providerTransactionId: "ptx_1",
        transactionDate: "2026-08-10",
        amount: toMoney(45.5),
        direction: "DEBIT",
        status: "POSTED",
        originalDescription: "WOOLWORTHS 1234",
      },
      [],
    );
    expect(decision.action).toBe("INSERT");
  });

  it("re-syncing an already-posted transaction with the same provider ID is a no-op, not a duplicate insert", () => {
    const existing: ExistingTransactionRef[] = [
      {
        id: "tx_1",
        accountId: "acc_1",
        providerTransactionId: "ptx_1",
        transactionDate: "2026-08-10",
        amount: toMoney(45.5),
        direction: "DEBIT",
        status: "POSTED",
      },
    ];
    const decision = resolveDedupe(
      {
        accountId: "acc_1",
        providerTransactionId: "ptx_1",
        transactionDate: "2026-08-10",
        amount: toMoney(45.5),
        direction: "DEBIT",
        status: "POSTED",
        originalDescription: "WOOLWORTHS 1234",
      },
      existing,
    );
    expect(decision).toEqual({ action: "SKIP_DUPLICATE", existingId: "tx_1" });
  });

  it("transitions a pending transaction to posted in place when the provider ID matches, instead of inserting a second row", () => {
    const existing: ExistingTransactionRef[] = [
      {
        id: "tx_1",
        accountId: "acc_1",
        providerTransactionId: "ptx_1",
        transactionDate: "2026-08-10",
        amount: toMoney(45.5),
        direction: "DEBIT",
        status: "PENDING",
      },
    ];
    const decision = resolveDedupe(
      {
        accountId: "acc_1",
        providerTransactionId: "ptx_1",
        transactionDate: "2026-08-11",
        amount: toMoney(45.5),
        direction: "DEBIT",
        status: "POSTED",
        originalDescription: "WOOLWORTHS 1234",
      },
      existing,
    );
    expect(decision).toEqual({ action: "UPDATE_STATUS_TO_POSTED", existingId: "tx_1", matchedBy: "providerId" });
  });

  it("matches pending-to-posted heuristically when the provider reissues the transaction ID on posting", () => {
    const existing: ExistingTransactionRef[] = [
      {
        id: "tx_1",
        accountId: "acc_1",
        providerTransactionId: "pending_ref_abc",
        transactionDate: "2026-08-10",
        amount: toMoney(120),
        direction: "DEBIT",
        status: "PENDING",
      },
    ];
    const decision = resolveDedupe(
      {
        accountId: "acc_1",
        providerTransactionId: "posted_ref_xyz",
        transactionDate: "2026-08-12",
        amount: toMoney(120),
        direction: "DEBIT",
        status: "POSTED",
        originalDescription: "BP FUEL",
      },
      existing,
    );
    expect(decision).toEqual({ action: "UPDATE_STATUS_TO_POSTED", existingId: "tx_1", matchedBy: "heuristic" });
  });

  it("does not heuristically match across accounts or outside the date window", () => {
    const existing: ExistingTransactionRef[] = [
      {
        id: "tx_1",
        accountId: "acc_OTHER",
        providerTransactionId: "pending_ref_abc",
        transactionDate: "2026-08-10",
        amount: toMoney(120),
        direction: "DEBIT",
        status: "PENDING",
      },
      {
        id: "tx_2",
        accountId: "acc_1",
        providerTransactionId: "pending_ref_old",
        transactionDate: "2026-07-01", // far outside the match window
        amount: toMoney(120),
        direction: "DEBIT",
        status: "PENDING",
      },
    ];
    const decision = resolveDedupe(
      {
        accountId: "acc_1",
        providerTransactionId: "posted_ref_xyz",
        transactionDate: "2026-08-12",
        amount: toMoney(120),
        direction: "DEBIT",
        status: "POSTED",
        originalDescription: "BP FUEL",
      },
      existing,
    );
    expect(decision.action).toBe("INSERT");
  });
});
