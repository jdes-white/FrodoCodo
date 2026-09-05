import { describe, expect, it } from "vitest";
import { resolveBudgetPeriod } from "../budgetPeriod.js";

describe("resolveBudgetPeriod — CALENDAR_MONTH", () => {
  it("resolves the full month regardless of reference day", () => {
    expect(resolveBudgetPeriod({ type: "CALENDAR_MONTH" }, "2026-02-14")).toEqual({
      startDate: "2026-02-01",
      endDate: "2026-02-28",
    });
  });

  it("handles leap years", () => {
    expect(resolveBudgetPeriod({ type: "CALENDAR_MONTH" }, "2028-02-01")).toEqual({
      startDate: "2028-02-01",
      endDate: "2028-02-29",
    });
  });
});

describe("resolveBudgetPeriod — ANCHORED_MONTHLY", () => {
  it("starts the cycle on the anchor day when reference date is after it", () => {
    expect(resolveBudgetPeriod({ type: "ANCHORED_MONTHLY", anchorDay: 15 }, "2026-08-20")).toEqual({
      startDate: "2026-08-15",
      endDate: "2026-09-14",
    });
  });

  it("uses the previous month's anchor when reference date is before it", () => {
    expect(resolveBudgetPeriod({ type: "ANCHORED_MONTHLY", anchorDay: 15 }, "2026-08-10")).toEqual({
      startDate: "2026-07-15",
      endDate: "2026-08-14",
    });
  });

  it("clamps an anchor day beyond a short month's length", () => {
    // anchorDay 31 in February should clamp to the 28th/29th.
    const result = resolveBudgetPeriod({ type: "ANCHORED_MONTHLY", anchorDay: 31 }, "2026-02-20");
    expect(result.startDate).toBe("2026-01-31");
    expect(result.endDate).toBe("2026-02-27");
  });

  it("lands exactly on the anchor day boundary", () => {
    expect(resolveBudgetPeriod({ type: "ANCHORED_MONTHLY", anchorDay: 1 }, "2026-08-01")).toEqual({
      startDate: "2026-08-01",
      endDate: "2026-08-31",
    });
  });
});

describe("resolveBudgetPeriod — FORTNIGHTLY", () => {
  const epoch = "2026-01-01";

  it("resolves the first cycle", () => {
    expect(resolveBudgetPeriod({ type: "FORTNIGHTLY", epoch }, "2026-01-05")).toEqual({
      startDate: "2026-01-01",
      endDate: "2026-01-14",
    });
  });

  it("resolves a later cycle", () => {
    expect(resolveBudgetPeriod({ type: "FORTNIGHTLY", epoch }, "2026-02-01")).toEqual({
      startDate: "2026-01-29",
      endDate: "2026-02-11",
    });
  });
});

describe("resolveBudgetPeriod — CUSTOM", () => {
  it("resolves an arbitrary cycle length", () => {
    const result = resolveBudgetPeriod(
      { type: "CUSTOM", epoch: "2026-01-01", lengthDays: 10 },
      "2026-01-25",
    );
    expect(result).toEqual({ startDate: "2026-01-21", endDate: "2026-01-30" });
  });
});
