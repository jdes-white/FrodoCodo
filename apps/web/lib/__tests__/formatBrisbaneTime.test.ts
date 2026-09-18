import { describe, expect, it } from "vitest";
import { formatBrisbaneTime } from "../formatBrisbaneTime";

describe("formatBrisbaneTime", () => {
  it("renders a UTC timestamp shifted to Brisbane's fixed UTC+10, not the ambient runtime timezone", () => {
    // 2026-09-06T03:14:00Z is 1:14pm Brisbane the same day (UTC+10, no DST) —
    // the exact scenario from the reported defect (a small-hours UTC
    // timestamp rendering as itself instead of the correct afternoon
    // Brisbane time).
    const result = formatBrisbaneTime(new Date("2026-09-06T03:14:00Z"));
    expect(result).toContain("1:14");
    expect(result).toMatch(/pm/i);
    expect(result).toContain("6 Sept");
  });

  it("never crosses a UTC day boundary incorrectly the other direction (late UTC evening is next-day Brisbane morning)", () => {
    // 2026-09-06T23:30:00Z is 2026-09-07T09:30 Brisbane.
    const result = formatBrisbaneTime(new Date("2026-09-06T23:30:00Z"));
    expect(result).toContain("7 Sept");
    expect(result).toContain("9:30");
    expect(result).toMatch(/am/i);
  });

  it("stays at UTC+10 year-round (Brisbane observes no daylight saving)", () => {
    // A date that would be UTC+11 in a DST-observing Australian state
    // (southern-hemisphere summer) must still be exactly +10 for Brisbane.
    const summer = formatBrisbaneTime(new Date("2026-01-15T14:00:00Z"));
    expect(summer).toContain("16 Jan");
    expect(summer).toContain("12:00");
    expect(summer).toMatch(/am/i);
  });
});
