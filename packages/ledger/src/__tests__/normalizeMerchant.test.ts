import { describe, expect, it } from "vitest";
import { normalizeMerchant } from "../normalizeMerchant.js";

describe("normalizeMerchant", () => {
  it("resolves a known alias regardless of noise around it", () => {
    const result = normalizeMerchant("WOOLWORTHS 1234 BRISBANE AU");
    expect(result.normalizedName).toBe("Woolworths");
    expect(result.confidence).toBe(1);
  });

  it("strips payment-processor prefixes", () => {
    const result = normalizeMerchant("SQ *CORNER CAFE SYDNEY NSW AU");
    expect(result.normalizedName).not.toMatch(/^SQ/);
  });

  it("produces a stable, comparable match key", () => {
    const a = normalizeMerchant("WOOLWORTHS 1234 BRISBANE AU");
    const b = normalizeMerchant("Woolworths 5678 Gold Coast AU");
    expect(a.matchKey).toBe(b.matchKey);
  });

  it("never discards information silently — falls back to cleaned original text", () => {
    const result = normalizeMerchant("RANDOM UNKNOWN MERCHANT XYZ 998877");
    expect(result.normalizedName.length).toBeGreaterThan(0);
    expect(result.confidence).toBeLessThan(1);
  });
});
