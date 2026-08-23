import { describe, expect, it } from "vitest";
import { derivePaceDifference, derivePaceStatus, derivePaceGradientPosition, paceStatusLabel, clampArcPercent } from "../pacePosition.js";

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
