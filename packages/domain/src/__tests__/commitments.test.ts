import { describe, expect, it } from "vitest";
import {
  isCommitmentDueInPeriod,
  summarizeCommitments,
  nextRecurrenceDate,
  isCommitmentDueWithinWindow,
  commitmentsDueWithinWindow,
  summarizeUpcomingWindow,
} from "../commitments.js";

const PERIOD = { startDate: "2026-08-01", endDate: "2026-08-31" };
const TODAY = "2026-08-28";

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

describe("isCommitmentDueWithinWindow / commitmentsDueWithinWindow", () => {
  it("includes a commitment due today and one due exactly on the window boundary", () => {
    expect(isCommitmentDueWithinWindow({ amount: 1, expectedDate: TODAY, completedAt: null }, TODAY, 7)).toBe(true);
    expect(isCommitmentDueWithinWindow({ amount: 1, expectedDate: "2026-09-04", completedAt: null }, TODAY, 7)).toBe(true);
  });

  it("excludes a commitment one day past the window", () => {
    expect(isCommitmentDueWithinWindow({ amount: 1, expectedDate: "2026-09-05", completedAt: null }, TODAY, 7)).toBe(false);
  });

  it("excludes a commitment already in the past", () => {
    expect(isCommitmentDueWithinWindow({ amount: 1, expectedDate: "2026-08-27", completedAt: null }, TODAY, 7)).toBe(false);
  });

  it("excludes a completed commitment even if its date is inside the window", () => {
    expect(isCommitmentDueWithinWindow({ amount: 1, expectedDate: TODAY, completedAt: "2026-08-20" }, TODAY, 7)).toBe(false);
  });

  it("filters and sorts soonest-first", () => {
    const commitments = [
      { amount: 240, expectedDate: "2026-09-01", completedAt: null },
      { amount: 999, expectedDate: "2026-09-20", completedAt: null }, // outside window
      { amount: 180, expectedDate: "2026-08-29", completedAt: null },
    ];
    const due = commitmentsDueWithinWindow(commitments, TODAY, 7);
    expect(due.map((c) => c.expectedDate)).toEqual(["2026-08-29", "2026-09-01"]);
  });
});

describe("summarizeUpcomingWindow", () => {
  it("returns a null phrase and zero total when nothing is due", () => {
    const summary = summarizeUpcomingWindow([], TODAY, 7);
    expect(summary.count).toBe(0);
    expect(summary.total.toNumber()).toBe(0);
    expect(summary.phrase).toBeNull();
  });

  it("says 'due tomorrow' for a single item one day out", () => {
    const summary = summarizeUpcomingWindow([{ amount: 180, expectedDate: "2026-08-29", completedAt: null }], TODAY, 7);
    expect(summary.total.toNumber()).toBe(180);
    expect(summary.phrase).toBe("due tomorrow");
  });

  it("says 'due today' for a single item due today", () => {
    const summary = summarizeUpcomingWindow([{ amount: 50, expectedDate: TODAY, completedAt: null }], TODAY, 7);
    expect(summary.phrase).toBe("due today");
  });

  it("says 'due in N days' for a single item inside the window but not at its edge", () => {
    const summary = summarizeUpcomingWindow([{ amount: 240, expectedDate: "2026-09-01", completedAt: null }], TODAY, 7);
    expect(summary.phrase).toBe("due in 4 days");
  });

  it("says 'due in the next N days' for a single item exactly on the window boundary", () => {
    const summary = summarizeUpcomingWindow([{ amount: 560, expectedDate: "2026-09-04", completedAt: null }], TODAY, 7);
    expect(summary.phrase).toBe("due in the next 7 days");
  });

  it("collapses multiple items to the window-boundary phrase and sums the total, regardless of their individual dates", () => {
    const summary = summarizeUpcomingWindow(
      [
        { amount: 180, expectedDate: "2026-08-29", completedAt: null },
        { amount: 240, expectedDate: "2026-09-01", completedAt: null },
      ],
      TODAY,
      7,
    );
    expect(summary.count).toBe(2);
    expect(summary.total.toNumber()).toBe(420);
    expect(summary.phrase).toBe("due in the next 7 days");
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
