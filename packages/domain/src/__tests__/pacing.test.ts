import { describe, expect, it } from "vitest";
import { calculatePacing } from "../pacing.js";

const AUGUST: { startDate: string; endDate: string } = { startDate: "2026-08-01", endDate: "2026-08-31" };

describe("calculatePacing — flexible categories", () => {
  it("flags AHEAD when spend is meaningfully below the linear expected curve", () => {
    // Day 10 of 31 (~32% elapsed) but only 20% of a $3000 budget spent.
    const result = calculatePacing({
      period: AUGUST,
      asOf: "2026-08-10",
      allocation: 3000,
      spentToDate: 600,
      spendingType: "FLEXIBLE",
    });
    expect(result.pacingStatus).toBe("AHEAD");
    expect(result.variance.toNumber()).toBeLessThan(0);
  });

  it("flags BEHIND when spend is meaningfully above the linear expected curve", () => {
    // Day 10 of 31 but 60% of budget already spent — this is the spec's own example.
    const result = calculatePacing({
      period: AUGUST,
      asOf: "2026-08-10",
      allocation: 3000,
      spentToDate: 1800,
      spendingType: "FLEXIBLE",
    });
    expect(result.pacingStatus).toBe("BEHIND");
    expect(result.variance.toNumber()).toBeGreaterThan(0);
  });

  it("is ON_TRACK when spend tracks the elapsed fraction within threshold", () => {
    const result = calculatePacing({
      period: AUGUST,
      asOf: "2026-08-16", // day 16 of 31 ≈ 51.6% elapsed
      allocation: 3100,
      spentToDate: 1600, // ≈ 51.6% spent
      spendingType: "FLEXIBLE",
    });
    expect(result.pacingStatus).toBe("ON_TRACK");
  });

  it("projects end-of-period spend from trailing velocity", () => {
    const result = calculatePacing({
      period: AUGUST,
      asOf: "2026-08-10",
      allocation: 1000,
      spentToDate: 400,
      trailingSpend: 140, // $20/day over a 7-day window
      trailingWindowDays: 7,
      spendingType: "FLEXIBLE",
    });
    // 21 days remaining * $20/day = $420 more spend => $820 projected total.
    expect(result.spendVelocityPerDay.toNumber()).toBe(20);
    expect(result.projectedEndOfPeriod.toNumber()).toBeCloseTo(820, 5);
    expect(result.projectedVariance.toNumber()).toBeCloseTo(-180, 5);
  });

  it("never divides by zero on a same-day period", () => {
    const result = calculatePacing({
      period: { startDate: "2026-08-01", endDate: "2026-08-01" },
      asOf: "2026-08-01",
      allocation: 100,
      spentToDate: 0,
    });
    expect(result.totalDays).toBe(1);
    expect(Number.isFinite(result.percentPeriodElapsed)).toBe(true);
  });
});

describe("calculatePacing — fixed commitments", () => {
  it("expects zero spend before the due date and full allocation after it", () => {
    const before = calculatePacing({
      period: AUGUST,
      asOf: "2026-08-10",
      allocation: 2200,
      spentToDate: 0,
      spendingType: "FIXED_COMMITMENT",
      fixedDueDayOfMonth: 15,
    });
    expect(before.expectedSpendToDate.toNumber()).toBe(0);
    expect(before.pacingStatus).toBe("ON_TRACK");

    const after = calculatePacing({
      period: AUGUST,
      asOf: "2026-08-16",
      allocation: 2200,
      spentToDate: 2200,
      spendingType: "FIXED_COMMITMENT",
      fixedDueDayOfMonth: 15,
    });
    expect(after.expectedSpendToDate.toNumber()).toBe(2200);
    expect(after.variance.toNumber()).toBe(0);
  });

  it("does not extrapolate a fixed commitment off spending velocity", () => {
    const result = calculatePacing({
      period: AUGUST,
      asOf: "2026-08-16",
      allocation: 2200,
      spentToDate: 2200,
      spendingType: "FIXED_COMMITMENT",
      fixedDueDayOfMonth: 15,
    });
    // Paid in full already — projection is the allocation, not spent + velocity*daysRemaining.
    expect(result.projectedEndOfPeriod.toNumber()).toBe(2200);
  });

  it("projects an over-allocation fixed cost at its actual higher amount", () => {
    const result = calculatePacing({
      period: AUGUST,
      asOf: "2026-08-16",
      allocation: 2200,
      spentToDate: 2350, // e.g. insurance premium increase
      spendingType: "FIXED_COMMITMENT",
      fixedDueDayOfMonth: 15,
    });
    expect(result.projectedEndOfPeriod.toNumber()).toBe(2350);
    expect(result.projectedVariance.toNumber()).toBe(150);
  });
});
