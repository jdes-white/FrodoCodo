import { describe, expect, it } from "vitest";
import type { PaceStatus } from "@frodocodo/domain";
import { paceStatusColorVar, paceStatusSoftColorVar, paceGradientColor } from "../pacePosition";

const ALL_STATUSES: PaceStatus[] = ["COMFORTABLY_AHEAD", "AHEAD_OF_PLAN", "ON_TRACK", "SLIGHTLY_OVER_PACE", "OVER_PACE"];

/**
 * The audit's confirmed colour-spectrum bug: `SpendPaceStatus`'s neutral
 * "ON_TRACK" tier rendered as blue (`--status-on-track`), breaking the
 * intended dark-green -> light-green -> amber/yellow -> orange -> red
 * spectrum on 3 of 4 status surfaces. That system is gone; these tests
 * pin the replacement (canonical `PaceStatus`, this module) to the
 * five-stop spectrum only, so a blue neutral can't quietly come back.
 */
describe("paceStatusColorVar / paceStatusSoftColorVar", () => {
  it("maps every status to one of the five --pace-* spectrum stops, never a --status-* token", () => {
    for (const status of ALL_STATUSES) {
      expect(paceStatusColorVar(status)).toMatch(/^var\(--pace-/);
      expect(paceStatusSoftColorVar(status)).toMatch(/^var\(--pace-/);
    }
  });

  it("ON_TRACK is the amber/yellow spectrum stop, not the old blue --status-on-track", () => {
    expect(paceStatusColorVar("ON_TRACK")).toBe("var(--pace-neutral)");
    expect(paceStatusColorVar("ON_TRACK")).not.toContain("--status-on-track");
  });

  it("assigns exactly the five intended, distinct spectrum stops, one per status, dark-green side to red side", () => {
    const colors = ALL_STATUSES.map(paceStatusColorVar);
    expect(colors).toEqual(["var(--pace-comfortable)", "var(--pace-ahead)", "var(--pace-neutral)", "var(--pace-over)", "var(--pace-critical)"]);
    expect(new Set(colors).size).toBe(5); // no two statuses collapse onto the same colour
  });

  it("every soft variant pairs with the same status's main colour's stop name", () => {
    for (const status of ALL_STATUSES) {
      const mainStop = paceStatusColorVar(status).replace("var(", "").replace(")", "");
      expect(paceStatusSoftColorVar(status)).toBe(`var(${mainStop}-soft)`);
    }
  });
});

describe("paceGradientColor", () => {
  it("resolves to the dark-green stop when comfortably ahead, and the red stop when far over pace", () => {
    expect(paceGradientColor(-100)).toBe("var(--pace-comfortable)");
    expect(paceGradientColor(100)).toBe("var(--pace-critical)");
  });

  it("resolves to a pure amber/yellow stop exactly on pace, never blue", () => {
    expect(paceGradientColor(0)).toBe("var(--pace-neutral)");
  });

  it("blends between two spectrum stops (never a --status-* token) at every named threshold", () => {
    for (const difference of [-10, -3, 0, 3, 10]) {
      const color = paceGradientColor(difference);
      expect(color).toMatch(/--pace-/);
      expect(color).not.toMatch(/--status-/);
    }
  });
});
