import { describe, expect, it } from "vitest";
import { allowedMoneyValues, narrativeCitesOnlyKnownFigures, type FinancialFactSheet } from "../factSheet.js";

const factSheet: FinancialFactSheet = {
  budgetPeriod: { startDate: "2026-08-01", endDate: "2026-08-31", percentElapsed: 50 },
  totals: { allocation: "$5,000.00", spent: "$2,300.00", remaining: "$2,700.00", status: "AHEAD_OF_PLAN" },
  buckets: [
    { name: "Lifestyle", allocation: "$800.00", spent: "$620.00", remaining: "$180.00", status: "SLIGHTLY_OVER_PACE" },
  ],
};

describe("allowedMoneyValues", () => {
  it("collects every dollar figure across totals, buckets, transactions, and comparisons", () => {
    const values = allowedMoneyValues(factSheet);
    expect(values.has("$5,000.00")).toBe(true);
    expect(values.has("$180.00")).toBe(true);
  });
});

describe("narrativeCitesOnlyKnownFigures", () => {
  it("accepts a narrative that only repeats fact-sheet numbers", () => {
    const narrative = "You have $2,700.00 remaining out of $5,000.00. Lifestyle has $180.00 left.";
    expect(narrativeCitesOnlyKnownFigures(narrative, factSheet)).toBe(true);
  });

  it("rejects a narrative that states a figure not present anywhere in the fact sheet", () => {
    const narrative = "You have $2,700.00 remaining, and you're projected to overspend by $999.00.";
    expect(narrativeCitesOnlyKnownFigures(narrative, factSheet)).toBe(false);
  });

  it("accepts a narrative with no dollar figures at all", () => {
    expect(narrativeCitesOnlyKnownFigures("Spending looks steady this week.", factSheet)).toBe(true);
  });
});
