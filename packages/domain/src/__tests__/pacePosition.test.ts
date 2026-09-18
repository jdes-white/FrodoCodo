import { describe, expect, it } from "vitest";
import { toMoney } from "@frodocodo/shared";
import {
  derivePaceDifference,
  derivePaceStatus,
  derivePaceStatusFromPacing,
  derivePaceGradientPosition,
  paceStatusLabel,
  explainPaceStatus,
  clampArcPercent,
  type PacePosableInput,
} from "../pacePosition.js";

describe("derivePaceDifference", () => {
  it("is actual minus expected", () => {
    expect(derivePaceDifference(40, 70)).toBe(-30);
    expect(derivePaceDifference(65, 50)).toBe(15);
    expect(derivePaceDifference(50, 50)).toBe(0);
  });
});

describe("derivePaceStatus — V1 ranges from the brief", () => {
  it("70% expected / 40% actual -> dark green (comfortably ahead)", () => {
    expect(derivePaceStatus(derivePaceDifference(40, 70))).toBe("COMFORTABLY_AHEAD");
  });

  it("50% expected / 44% actual -> light green (ahead of plan)", () => {
    expect(derivePaceStatus(derivePaceDifference(44, 50))).toBe("AHEAD_OF_PLAN");
  });

  it("50% expected / 50% actual -> yellow (on track)", () => {
    expect(derivePaceStatus(derivePaceDifference(50, 50))).toBe("ON_TRACK");
  });

  it("50% expected / 55% actual -> orange (slightly over pace)", () => {
    expect(derivePaceStatus(derivePaceDifference(55, 50))).toBe("SLIGHTLY_OVER_PACE");
  });

  it("50% expected / 65% actual -> red (over pace)", () => {
    expect(derivePaceStatus(derivePaceDifference(65, 50))).toBe("OVER_PACE");
  });

  it("is a contiguous, gapless partition at every named threshold", () => {
    expect(derivePaceStatus(-10)).toBe("COMFORTABLY_AHEAD");
    expect(derivePaceStatus(-10.01)).toBe("COMFORTABLY_AHEAD");
    expect(derivePaceStatus(-9.99)).toBe("AHEAD_OF_PLAN");
    expect(derivePaceStatus(-3)).toBe("AHEAD_OF_PLAN");
    expect(derivePaceStatus(-2.99)).toBe("ON_TRACK");
    expect(derivePaceStatus(0)).toBe("ON_TRACK");
    expect(derivePaceStatus(2.99)).toBe("ON_TRACK");
    expect(derivePaceStatus(3)).toBe("SLIGHTLY_OVER_PACE");
    expect(derivePaceStatus(9.99)).toBe("SLIGHTLY_OVER_PACE");
    expect(derivePaceStatus(10)).toBe("OVER_PACE");
    expect(derivePaceStatus(10.01)).toBe("OVER_PACE");
  });

  it("handles extreme differences (100% overspend, zero spend) without leaving a gap", () => {
    expect(derivePaceStatus(-100)).toBe("COMFORTABLY_AHEAD");
    expect(derivePaceStatus(100)).toBe("OVER_PACE");
  });
});

describe("paceStatusLabel", () => {
  it("uses the exact wording from the brief", () => {
    expect(paceStatusLabel("COMFORTABLY_AHEAD")).toBe("Comfortably on track");
    expect(paceStatusLabel("AHEAD_OF_PLAN")).toBe("Ahead of plan");
    expect(paceStatusLabel("ON_TRACK")).toBe("On track");
    expect(paceStatusLabel("SLIGHTLY_OVER_PACE")).toBe("Slightly over pace");
    expect(paceStatusLabel("OVER_PACE")).toBe("Over pace");
  });
});

describe("derivePaceGradientPosition", () => {
  it("is 0.5 exactly on pace (pure yellow)", () => {
    expect(derivePaceGradientPosition(0)).toBe(0.5);
  });

  it("is 0 at the dark-green threshold and 1 at the red threshold", () => {
    expect(derivePaceGradientPosition(-10)).toBe(0);
    expect(derivePaceGradientPosition(10)).toBe(1);
  });

  it("lands on the same interior anchor points the discrete thresholds use (-3 -> 0.35, +3 -> 0.65)", () => {
    expect(derivePaceGradientPosition(-3)).toBeCloseTo(0.35, 10);
    expect(derivePaceGradientPosition(3)).toBeCloseTo(0.65, 10);
  });

  it("clamps beyond the thresholds instead of intensifying indefinitely", () => {
    expect(derivePaceGradientPosition(-500)).toBe(0);
    expect(derivePaceGradientPosition(500)).toBe(1);
  });

  it("is monotonically non-decreasing as the difference increases", () => {
    const samples = [-40, -15, -10, -6, -3, -1, 0, 1, 3, 5, 10, 15, 40];
    const positions = samples.map(derivePaceGradientPosition);
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i]!).toBeGreaterThanOrEqual(positions[i - 1]!);
    }
  });
});

/**
 * `derivePaceStatusFromPacing` is the canonical adapter every UI/AI status
 * surface now calls (Home's bucket cards, bucket-detail, Insights, the AI
 * fact sheet) — these tests fix allocation at $100 so `expectedSpendToDate`
 * dollars read directly as expected-percent points, letting the exact same
 * boundary values `derivePaceStatus` is tested against above (-10, -3, 0,
 * 3, 10) be hit precisely through the full PacingResult-shaped path,
 * ±0.01 included.
 */
function pacingAt(percentConsumed: number, expectedSpendToDate: number): PacePosableInput {
  return { percentConsumed, allocation: toMoney(100), expectedSpendToDate: toMoney(expectedSpendToDate) };
}

describe("derivePaceStatusFromPacing", () => {
  it("matches derivePaceStatus at every named boundary and ±0.01 around it, composed from a PacingResult-shaped input", () => {
    expect(derivePaceStatusFromPacing(pacingAt(40, 50))).toBe("COMFORTABLY_AHEAD"); // exactly -10
    expect(derivePaceStatusFromPacing(pacingAt(39.99, 50))).toBe("COMFORTABLY_AHEAD"); // -10.01
    expect(derivePaceStatusFromPacing(pacingAt(40.01, 50))).toBe("AHEAD_OF_PLAN"); // -9.99

    expect(derivePaceStatusFromPacing(pacingAt(47, 50))).toBe("AHEAD_OF_PLAN"); // exactly -3
    expect(derivePaceStatusFromPacing(pacingAt(46.99, 50))).toBe("AHEAD_OF_PLAN"); // -3.01
    expect(derivePaceStatusFromPacing(pacingAt(47.01, 50))).toBe("ON_TRACK"); // -2.99

    expect(derivePaceStatusFromPacing(pacingAt(50, 50))).toBe("ON_TRACK"); // exactly on pace

    expect(derivePaceStatusFromPacing(pacingAt(52.99, 50))).toBe("ON_TRACK"); // 2.99
    expect(derivePaceStatusFromPacing(pacingAt(53, 50))).toBe("SLIGHTLY_OVER_PACE"); // exactly +3
    expect(derivePaceStatusFromPacing(pacingAt(53.01, 50))).toBe("SLIGHTLY_OVER_PACE"); // 3.01

    expect(derivePaceStatusFromPacing(pacingAt(59.99, 50))).toBe("SLIGHTLY_OVER_PACE"); // 9.99
    expect(derivePaceStatusFromPacing(pacingAt(60, 50))).toBe("OVER_PACE"); // exactly +10
    expect(derivePaceStatusFromPacing(pacingAt(60.01, 50))).toBe("OVER_PACE"); // 10.01
  });

  it("classifies a $0-allocation category with real spend as ON_TRACK rather than dividing by zero — an existing, understood edge case", () => {
    expect(derivePaceStatusFromPacing({ percentConsumed: 0, allocation: toMoney(0), expectedSpendToDate: toMoney(0) })).toBe("ON_TRACK");
  });

  it("agrees with Insights/AI's own inputs: the same PacingResult always classifies the same way regardless of which surface asks", () => {
    const bucketPacing = pacingAt(65, 50); // clearly over pace
    const totalPacing = pacingAt(65, 50); // a different surface, identical numbers
    expect(derivePaceStatusFromPacing(bucketPacing)).toBe(derivePaceStatusFromPacing(totalPacing));
    expect(derivePaceStatusFromPacing(bucketPacing)).toBe("OVER_PACE");
  });
});

describe("explainPaceStatus", () => {
  it("reports the same status derivePaceStatusFromPacing would, plus a plain-facts summary line", () => {
    const explanation = explainPaceStatus({ ...pacingAt(65, 50), percentPeriodElapsed: 50.4 }, "flexible budget");
    expect(explanation.status).toBe("OVER_PACE");
    expect(explanation.summary).toBe("50% through the period · 65% of flexible budget used");
  });

  it("defaults the budget label to plain 'budget' when the caller doesn't say otherwise", () => {
    const explanation = explainPaceStatus({ ...pacingAt(50, 50), percentPeriodElapsed: 50 });
    expect(explanation.summary).toContain("of budget used");
  });
});

describe("clampArcPercent", () => {
  it("passes values within 0-100 straight through", () => {
    expect(clampArcPercent(42)).toBe(42);
    expect(clampArcPercent(0)).toBe(0);
    expect(clampArcPercent(100)).toBe(100);
  });

  it("floors a negative percent at 0 (zero spending)", () => {
    expect(clampArcPercent(-1)).toBe(0);
  });

  it("caps an overspend at 100 rather than wrapping the arc around for a second lap", () => {
    expect(clampArcPercent(140)).toBe(100);
    expect(clampArcPercent(100.01)).toBe(100);
  });
});
