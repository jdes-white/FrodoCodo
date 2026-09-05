import { describe, expect, it } from "vitest";
import { addDays, daysBetween, clampDate, isBefore, isAfter, daysInMonth } from "../date.js";

describe("addDays", () => {
  it("adds days within a month", () => {
    expect(addDays("2026-08-10", 5)).toBe("2026-08-15");
  });

  it("rolls over a month boundary", () => {
    expect(addDays("2026-08-30", 3)).toBe("2026-09-02");
  });

  it("supports negative offsets", () => {
    expect(addDays("2026-08-01", -1)).toBe("2026-07-31");
  });

  it("handles a leap-year February correctly", () => {
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
  });
});

describe("daysBetween", () => {
  it("computes a positive gap", () => {
    expect(daysBetween("2026-08-01", "2026-08-15")).toBe(14);
  });

  it("computes a negative gap", () => {
    expect(daysBetween("2026-08-15", "2026-08-01")).toBe(-14);
  });

  it("is zero for the same date", () => {
    expect(daysBetween("2026-08-01", "2026-08-01")).toBe(0);
  });
});

describe("clampDate / isBefore / isAfter", () => {
  it("clamps a date below the minimum", () => {
    expect(clampDate("2026-07-01", "2026-08-01", "2026-08-31")).toBe("2026-08-01");
  });

  it("clamps a date above the maximum", () => {
    expect(clampDate("2026-09-15", "2026-08-01", "2026-08-31")).toBe("2026-08-31");
  });

  it("leaves an in-range date untouched", () => {
    expect(clampDate("2026-08-15", "2026-08-01", "2026-08-31")).toBe("2026-08-15");
  });

  it("compares ordering correctly", () => {
    expect(isBefore("2026-08-01", "2026-08-02")).toBe(true);
    expect(isAfter("2026-08-02", "2026-08-01")).toBe(true);
  });
});

describe("daysInMonth", () => {
  it("knows February in a leap year", () => {
    expect(daysInMonth(2028, 1)).toBe(29);
  });

  it("knows February in a non-leap year", () => {
    expect(daysInMonth(2026, 1)).toBe(28);
  });

  it("knows a 31-day month", () => {
    expect(daysInMonth(2026, 7)).toBe(31);
  });
});
