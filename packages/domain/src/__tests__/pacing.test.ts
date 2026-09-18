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

describe("calculatePacing — expectedSpendToDateOverride (aggregation, pacing Stage 2)", () => {
  it("without an override, an aggregate containing a lump-sum fixed commitment wrongly looks like it's overspending the moment the bill posts", () => {
    // A bucket combining a $2400 mortgage (due day 3) and $900 flexible
    // groceries, $3300 total. On day 3, only the mortgage has posted
    // ($2400 spent) — early in the month, so naive linear expected-to-date
    // for the WHOLE bucket is tiny, making it look wildly overspent even
    // though the mortgage posting on schedule is completely normal.
    const naive = calculatePacing({
      period: AUGUST,
      asOf: "2026-08-03",
      allocation: 3300,
      spentToDate: 2400,
    });
    expect(naive.pacingStatus).toBe("BEHIND"); // "BEHIND" = overspending relative to naive pace — the bug.
  });

  it("with expectedSpendToDateOverride summed from correctly-modeled children, the same scenario reads as on track", () => {
    const mortgage = calculatePacing({
      period: AUGUST,
      asOf: "2026-08-03",
      allocation: 2400,
      spentToDate: 2400,
      spendingType: "FIXED_COMMITMENT",
      fixedDueDayOfMonth: 3,
    });
    const groceries = calculatePacing({
      period: AUGUST,
      asOf: "2026-08-03",
      allocation: 900,
      spentToDate: 0,
      spendingType: "FLEXIBLE",
    });
    const expectedSpendToDateOverride = mortgage.expectedSpendToDate.plus(groceries.expectedSpendToDate);

    const aggregate = calculatePacing({
      period: AUGUST,
      asOf: "2026-08-03",
      allocation: 3300,
      spentToDate: 2400,
      expectedSpendToDateOverride,
    });

    // Mortgage contributes its full $2400 (posted) + groceries' small ~3-days-in
    // linear share — not a flat linear smear of the combined $3300 allocation
    // (which on day 3 of 31 would naively expect only ~$319 spent so far).
    expect(aggregate.expectedSpendToDate.toNumber()).toBeCloseTo(expectedSpendToDateOverride.toNumber(), 5);
    expect(aggregate.expectedSpendToDate.toNumber()).toBeGreaterThan(2400);
    expect(aggregate.variance.abs().toNumber()).toBeLessThan(100); // close to expected either way
    expect(aggregate.pacingStatus).toBe("ON_TRACK");
  });

  it("still lets a genuinely-overspending aggregate register as such once the fixed commitment is accounted for", () => {
    const mortgage = calculatePacing({
      period: AUGUST,
      asOf: "2026-08-10",
      allocation: 2400,
      spentToDate: 2400,
      spendingType: "FIXED_COMMITMENT",
      fixedDueDayOfMonth: 3,
    });
    const groceries = calculatePacing({
      period: AUGUST,
      asOf: "2026-08-10",
      allocation: 900,
      spentToDate: 700, // way ahead of the ~10-day linear expectation (~290)
      spendingType: "FLEXIBLE",
    });
    const expectedSpendToDateOverride = mortgage.expectedSpendToDate.plus(groceries.expectedSpendToDate);

    const aggregate = calculatePacing({
      period: AUGUST,
      asOf: "2026-08-10",
      allocation: 3300,
      spentToDate: 3100,
      expectedSpendToDateOverride,
    });

    expect(aggregate.pacingStatus).toBe("BEHIND"); // genuinely overspending on groceries, correctly still flagged.
  });
});
