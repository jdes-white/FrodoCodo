import { describe, expect, it } from "vitest";
import { toMoney } from "@frodocodo/shared";
import { resolveScreenshotBatch, type ScreenshotDedupeCandidate, type ScreenshotDedupeExisting } from "../screenshotDedupe.js";

function candidate(overrides: Partial<ScreenshotDedupeCandidate> = {}): ScreenshotDedupeCandidate {
  return {
    accountId: "acc-1",
    transactionDate: "2026-08-30",
    amount: toMoney("12.52"),
    direction: "DEBIT",
    status: "POSTED",
    description: "SU HUANG PTY LTD CHERMSIDE",
    sourceKey: "screenshot-1",
    confidence: 0.95,
    ...overrides,
  };
}

function existing(overrides: Partial<ScreenshotDedupeExisting> = {}): ScreenshotDedupeExisting {
  return {
    id: "existing-1",
    accountId: "acc-1",
    transactionDate: "2026-08-30",
    amount: toMoney("12.52"),
    direction: "DEBIT",
    status: "POSTED",
    description: "SU HUANG PTY LTD CHERMSIDE",
    ...overrides,
  };
}

describe("resolveScreenshotBatch — cross-batch duplicate detection", () => {
  it("collapses the same transaction appearing in two overlapping screenshots to one insert", () => {
    const candidates = [
      candidate({ sourceKey: "screenshot-A" }),
      candidate({ sourceKey: "screenshot-B" }),
    ];
    const outcomes = resolveScreenshotBatch(candidates, []);
    const actions = outcomes.map((o) => o.action).sort();
    expect(actions).toEqual(["INSERT", "SKIP_DUPLICATE_OF_CANDIDATE"]);
  });

  it("skips a candidate that already exists in the database", () => {
    const outcomes = resolveScreenshotBatch([candidate()], [existing()]);
    expect(outcomes[0]).toEqual({ action: "SKIP_DUPLICATE", matchedExistingId: "existing-1" });
  });

  it("is order-independent — the same batch in reverse order produces the same shape of result", () => {
    const a = candidate({ sourceKey: "screenshot-A" });
    const b = candidate({ sourceKey: "screenshot-B" });
    const forward = resolveScreenshotBatch([a, b], []).map((o) => o.action).sort();
    const backward = resolveScreenshotBatch([b, a], []).map((o) => o.action).sort();
    expect(forward).toEqual(backward);
  });
});

describe("resolveScreenshotBatch — legitimate same merchant/date/amount collisions", () => {
  it("keeps both when a SINGLE screenshot shows the fingerprint twice (two real transactions)", () => {
    const candidates = [
      candidate({ sourceKey: "screenshot-A" }),
      candidate({ sourceKey: "screenshot-A" }),
    ];
    const outcomes = resolveScreenshotBatch(candidates, []);
    expect(outcomes.every((o) => o.action === "INSERT")).toBe(true);
  });

  it("still keeps both even if a second, overlapping screenshot also shows the fingerprint twice", () => {
    const candidates = [
      candidate({ sourceKey: "screenshot-A" }),
      candidate({ sourceKey: "screenshot-A" }),
      candidate({ sourceKey: "screenshot-B" }),
      candidate({ sourceKey: "screenshot-B" }),
    ];
    const outcomes = resolveScreenshotBatch(candidates, []);
    const inserted = outcomes.filter((o) => o.action === "INSERT");
    const skipped = outcomes.filter((o) => o.action === "SKIP_DUPLICATE_OF_CANDIDATE");
    expect(inserted).toHaveLength(2);
    expect(skipped).toHaveLength(2);
  });

  it("does not collapse two existing legitimate transactions just because a screenshot re-shows one of them", () => {
    const existingRows = [existing({ id: "e1" }), existing({ id: "e2" })];
    const outcomes = resolveScreenshotBatch([candidate({ sourceKey: "screenshot-A" })], existingRows);
    expect(outcomes[0]!.action).toBe("SKIP_DUPLICATE");
  });
});

describe("resolveScreenshotBatch — pending to posted matching", () => {
  it("updates an existing pending transaction to posted instead of inserting a duplicate", () => {
    const pendingExisting = existing({ status: "PENDING", transactionDate: "2026-08-28" });
    const postedCandidate = candidate({ status: "POSTED", transactionDate: "2026-08-30" });
    const outcomes = resolveScreenshotBatch([postedCandidate], [pendingExisting]);
    expect(outcomes[0]).toEqual({ action: "UPDATE_STATUS_TO_POSTED", matchedExistingId: "existing-1" });
  });

  it("does not match a pending->posted transition beyond the tolerance window", () => {
    const pendingExisting = existing({ status: "PENDING", transactionDate: "2026-08-01" });
    const postedCandidate = candidate({ status: "POSTED", transactionDate: "2026-08-30" });
    const outcomes = resolveScreenshotBatch([postedCandidate], [pendingExisting]);
    expect(outcomes[0]!.action).toBe("INSERT");
  });
});

describe("resolveScreenshotBatch — wrapped/truncated descriptions still match", () => {
  it("matches a cut-off description against the full one", () => {
    const truncated = candidate({ sourceKey: "screenshot-A", description: "T SHINE CASE" });
    const full = candidate({ sourceKey: "screenshot-B", description: "T SHINE CASE CHERMSIDE AU" });
    const outcomes = resolveScreenshotBatch([truncated, full], []);
    const actions = outcomes.map((o) => o.action).sort();
    expect(actions).toEqual(["INSERT", "SKIP_DUPLICATE_OF_CANDIDATE"]);
  });
});

describe("resolveScreenshotBatch — genuinely ambiguous collisions go to review, not auto-merge or silent drop", () => {
  it("flags a same account/amount/date/direction match with a materially different description as NEEDS_REVIEW", () => {
    const candidates = [
      candidate({ sourceKey: "screenshot-A", description: "COLES 0092 EVERTON PARK AU" }),
      candidate({ sourceKey: "screenshot-B", description: "COLES 0092 EVERTON PARK QLD" }),
    ];
    const outcomes = resolveScreenshotBatch(candidates, []);
    // Neither silently dropped nor auto-merged as a confident duplicate —
    // both sides of a merely-WEAK match are inserted (so no real spending
    // is lost) and at least flagged so a human can confirm.
    expect(outcomes.every((o) => o.action === "INSERT" || o.action === "NEEDS_REVIEW")).toBe(true);
    expect(outcomes.some((o) => o.action === "NEEDS_REVIEW")).toBe(true);
  });

  it("flags a candidate against an existing transaction whose description only partially overlaps", () => {
    const existingRow = existing({ description: "PAYMENT TO PAUL RENOUF COMMBANK APP HM SHARED" });
    const candidateRow = candidate({ description: "PAYMENT TO PAUL RENOUF COMMBANK APP FOOD MONEY" });
    const outcomes = resolveScreenshotBatch([candidateRow], [existingRow]);
    expect(outcomes[0]!.action).toBe("NEEDS_REVIEW");
  });

  it("never confuses two genuinely unrelated transactions (different merchant/amount) as a match", () => {
    const candidates = [
      candidate({ sourceKey: "screenshot-A", description: "COLES BROOKSIDE", amount: toMoney("250.60") }),
      candidate({ sourceKey: "screenshot-B", description: "GRILL'D EVERTON PARK", amount: toMoney("47.50") }),
    ];
    const outcomes = resolveScreenshotBatch(candidates, []);
    expect(outcomes.every((o) => o.action === "INSERT")).toBe(true);
  });

  it("never merges across different accounts even with identical everything else", () => {
    const candidates = [
      candidate({ sourceKey: "screenshot-A", accountId: "acc-cba" }),
      candidate({ sourceKey: "screenshot-B", accountId: "acc-virgin" }),
    ];
    const outcomes = resolveScreenshotBatch(candidates, []);
    expect(outcomes.every((o) => o.action === "INSERT")).toBe(true);
  });
});
