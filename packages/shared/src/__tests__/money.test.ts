import { describe, expect, it } from "vitest";
import { toMoney, sumMoney, clampMin, formatAUD, formatCompactAUD, percentage, ZERO } from "../money.js";

describe("toMoney / sumMoney", () => {
  it("parses numbers and strings without floating-point drift", () => {
    expect(toMoney(0.1).plus(toMoney(0.2)).toString()).toBe("0.3");
  });

  it("sums a list of money values", () => {
    expect(sumMoney([toMoney(10), toMoney(20.5), toMoney(0.5)]).toNumber()).toBe(31);
  });

  it("sums an empty list to zero", () => {
    expect(sumMoney([]).equals(ZERO)).toBe(true);
  });
});

describe("clampMin", () => {
  it("floors a value at the minimum", () => {
    expect(clampMin(toMoney(-50)).toNumber()).toBe(0);
  });

  it("leaves a value above the minimum untouched", () => {
    expect(clampMin(toMoney(50)).toNumber()).toBe(50);
  });
});

describe("formatAUD", () => {
  it("formats with thousands separators and two decimal places", () => {
    expect(formatAUD(toMoney(1234567.5))).toBe("$1,234,567.50");
  });

  it("formats a negative amount with a leading minus", () => {
    expect(formatAUD(toMoney(-42))).toBe("-$42.00");
  });

  it("formats zero", () => {
    expect(formatAUD(toMoney(0))).toBe("$0.00");
  });

  it("formats small values under a thousand without a separator", () => {
    expect(formatAUD(toMoney(9.5))).toBe("$9.50");
  });
});

describe("formatCompactAUD", () => {
  it("formats thousands with a trimmed 'k' suffix, matching the North Star spec example exactly", () => {
    expect(formatCompactAUD(toMoney(17600))).toBe("$17.6k");
  });

  it("drops the decimal when it's a whole number of thousands", () => {
    expect(formatCompactAUD(toMoney(19000))).toBe("$19k");
  });

  it("formats millions with an 'm' suffix", () => {
    expect(formatCompactAUD(toMoney(1200000))).toBe("$1.2m");
  });

  it("falls back to full formatting under one thousand", () => {
    expect(formatCompactAUD(toMoney(950))).toBe("$950.00");
  });

  it("preserves a negative sign", () => {
    expect(formatCompactAUD(toMoney(-17600))).toBe("-$17.6k");
  });
});

describe("percentage", () => {
  it("computes a percentage of a whole", () => {
    expect(percentage(toMoney(25), toMoney(200))).toBe(12.5);
  });

  it("returns 0 rather than dividing by zero", () => {
    expect(percentage(toMoney(25), toMoney(0))).toBe(0);
  });
});
