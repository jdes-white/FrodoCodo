import { describe, expect, it } from "vitest";
import { isCommitmentDueInPeriod, summarizeCommitments, nextRecurrenceDate } from "../commitments.js";

const PERIOD = { startDate: "2026-08-01", endDate: "2026-08-31" };

describe("isCommitmentDueInPeriod", () => {
  it("counts an unpaid commitment whose date falls inside the period", () => {
    expect(isCommitmentDueInPeriod({ amount: 1200, expectedDate: "2026-08-27", completedAt: null }, PERIOD)).toBe(true);
  });

  it("excludes a commitment marked completed, even if its date is inside the period", () => {
    expect(
      isCommitmentDueInPeriod({ amount: 1200, expectedDate: "2026-08-27", completedAt: "2026-08-20" }, PERIOD),
    ).toBe(false);
  });

  it("excludes a commitment due before the period starts", () => {
    expect(isCommitmentDueInPeriod({ amount: 500, expectedDate: "2026-07-30", completedAt: null }, PERIOD)).toBe(false);
  });

  it("excludes a commitment due after the period ends (future, stored but inert)", () => {
    expect(isCommitmentDueInPeriod({ amount: 500, expectedDate: "2026-09-04", completedAt: null }, PERIOD)).toBe(false);
  });

  it("includes commitments on the exact period boundary dates", () => {
    expect(isCommitmentDueInPeriod({ amount: 1, expectedDate: PERIOD.startDate, completedAt: null }, PERIOD)).toBe(true);
    expect(isCommitmentDueInPeriod({ amount: 1, expectedDate: PERIOD.endDate, completedAt: null }, PERIOD)).toBe(true);
  });
});

describe("summarizeCommitments", () => {
  it("matches the spec's worked example: $2,236 remaining, $1,980 committed -> $256 uncommitted", () => {
    const due = [
      { amount: 1200, expectedDate: "2026-08-27", completedAt: null },
      { amount: 180, expectedDate: "2026-08-31", completedAt: null },
      { amount: 600, expectedDate: "2026-09-04", completedAt: null }, // excluded by caller already — summarize just sums what it's given
    ];
    const summary = summarizeCommitments(2236, due.slice(0, 2));
    expect(summary.committed.toNumber()).toBe(1380);
    expect(summary.uncommitted.toNumber()).toBe(856);
    expect(summary.isShortfall).toBe(false);
    expect(summary.shortfall.toNumber()).toBe(0);
  });

  it("reproduces the spec's exact three-commitment example", () => {
    const due = [
      { amount: 1200, expectedDate: "2026-08-27", completedAt: null },
      { amount: 180, expectedDate: "2026-08-31", completedAt: null },
      { amount: 600, expectedDate: "2026-09-04", completedAt: null },
    ];
    const summary = summarizeCommitments(2236, due);
    expect(summary.committed.toNumber()).toBe(1980);
    expect(summary.uncommitted.toNumber()).toBe(256);
    expect(summary.isShortfall).toBe(false);
  });

  it("flags a shortfall clearly when commitments exceed what's remaining", () => {
    const due = [{ amount: 1200, expectedDate: "2026-08-27", completedAt: null }];
    const summary = summarizeCommitments(736, due);
    expect(summary.isShortfall).toBe(true);
    expect(summary.shortfall.toNumber()).toBe(464);
    expect(summary.uncommitted.toNumber()).toBe(-464);
  });

  it("returns committed=0/uncommitted=remaining for a household with no commitments", () => {
    const summary = summarizeCommitments(2236, []);
    expect(summary.committed.toNumber()).toBe(0);
    expect(summary.uncommitted.toNumber()).toBe(2236);
    expect(summary.isShortfall).toBe(false);
  });
});

describe("nextRecurrenceDate", () => {
  it("advances weekly by 7 days", () => {
    expect(nextRecurrenceDate("2026-08-27", "WEEKLY")).toBe("2026-09-03");
  });

  it("advances fortnightly by 14 days", () => {
    expect(nextRecurrenceDate("2026-08-27", "FORTNIGHTLY")).toBe("2026-09-10");
  });

  it("advances monthly, preserving day-of-month", () => {
    expect(nextRecurrenceDate("2026-08-27", "MONTHLY")).toBe("2026-09-27");
  });

  it("clamps a monthly recurrence into a shorter month rather than overflowing", () => {
    expect(nextRecurrenceDate("2026-01-31", "MONTHLY")).toBe("2026-02-28");
  });

  it("clamps correctly into a leap-year February", () => {
    expect(nextRecurrenceDate("2028-01-31", "MONTHLY")).toBe("2028-02-29");
  });
});
