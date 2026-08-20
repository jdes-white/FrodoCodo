import { describe, expect, it } from "vitest";
import { toMoney } from "@frodocodo/shared";
import { deriveSpendPaceStatus, spendPaceLabel, explainSpendPace } from "../spendPace.js";

function pacingLike(variance: number, allocation: number) {
  return { variance: toMoney(variance), allocation: toMoney(allocation) };
}

describe("deriveSpendPaceStatus", () => {
  it("is COMFORTABLY_ON_TRACK when spending is meaningfully under the pace-aware expectation", () => {
    expect(deriveSpendPaceStatus(pacingLike(-200, 1000))).toBe("COMFORTABLY_ON_TRACK");
  });

  it("is ON_TRACK within the small threshold band either side of expected", () => {
    expect(deriveSpendPaceStatus(pacingLike(30, 1000))).toBe("ON_TRACK");
    expect(deriveSpendPaceStatus(pacingLike(-30, 1000))).toBe("ON_TRACK");
  });

  it("is WATCH_SPENDING moderately over the expected pace", () => {
    expect(deriveSpendPaceStatus(pacingLike(100, 1000))).toBe("WATCH_SPENDING");
  });

  it("is OFF_TRACK well over the expected pace", () => {
    expect(deriveSpendPaceStatus(pacingLike(200, 1000))).toBe("OFF_TRACK");
  });

  it("never divides by zero on a zero-allocation category", () => {
    expect(deriveSpendPaceStatus(pacingLike(0, 0))).toBe("ON_TRACK");
  });

  it("reflects the exact 'money remains but spending too fast' scenario from the brief", () => {
    // 10% of the period elapsed, but 50% of a $1000 flexible budget already spent.
    const allocation = 1000;
    const expectedSpendToDate = allocation * 0.1; // linear baseline at 10% elapsed
    const spentToDate = allocation * 0.5;
    const variance = spentToDate - expectedSpendToDate; // +400
    const status = deriveSpendPaceStatus(pacingLike(variance, allocation));
    expect(status).not.toBe("COMFORTABLY_ON_TRACK");
    expect(status).not.toBe("ON_TRACK");
    expect(["WATCH_SPENDING", "OFF_TRACK"]).toContain(status);
  });
});

describe("spendPaceLabel", () => {
  it("uses unambiguous language, not the old AHEAD/BEHIND-style wording", () => {
    expect(spendPaceLabel("COMFORTABLY_ON_TRACK")).toBe("Comfortably on track");
    expect(spendPaceLabel("ON_TRACK")).toBe("On track");
    expect(spendPaceLabel("WATCH_SPENDING")).toBe("Watch spending");
    expect(spendPaceLabel("OFF_TRACK")).toBe("Off track");
  });
});

describe("explainSpendPace", () => {
  it("produces a short deterministic summary from period/spend percentages, never an unexplained score", () => {
    const explanation = explainSpendPace({
      variance: toMoney(30),
      allocation: toMoney(1000),
      percentPeriodElapsed: 48,
      percentConsumed: 42,
    });
    expect(explanation.summary).toBe("48% through the period · 42% of budget used");
    expect(explanation.status).toBe("ON_TRACK");
  });

  it("accepts a custom budget label (e.g. 'flexible budget')", () => {
    const explanation = explainSpendPace(
      { variance: toMoney(0), allocation: toMoney(1000), percentPeriodElapsed: 48, percentConsumed: 42 },
      "flexible budget",
    );
    expect(explanation.summary).toBe("48% through the period · 42% of flexible budget used");
  });
});
