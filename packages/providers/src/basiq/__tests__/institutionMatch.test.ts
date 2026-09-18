import { describe, expect, it } from "vitest";
import { findSupportedInstitutions } from "../institutionMatch.js";
import type { BasiqInstitution } from "../types.js";

function institution(id: string, name: string, shortName: string): BasiqInstitution {
  return { id, name, shortName, country: "AU" };
}

describe("findSupportedInstitutions (Task 7A.1 item 5 — deterministic, fail-closed matching)", () => {
  it("matches CBA and Virgin by exact approved name, ignoring unrelated institutions", () => {
    const institutions = [
      institution("inst-cba", "Commonwealth Bank", "CommBank"),
      institution("inst-virgin", "Virgin Money", "Virgin"),
      institution("inst-amex", "American Express", "Amex"),
      institution("inst-anz", "ANZ", "ANZ"),
    ];

    const { cba, virgin } = findSupportedInstitutions(institutions);
    expect(cba?.id).toBe("inst-cba");
    expect(virgin?.id).toBe("inst-virgin");
  });

  it("matches by approved short name too, not only the full name", () => {
    const institutions = [institution("inst-1", "Some Unexpected Full Name", "CBA")];
    const { cba } = findSupportedInstitutions(institutions);
    expect(cba?.id).toBe("inst-1");
  });

  it("is case-insensitive", () => {
    const institutions = [institution("inst-1", "commonwealth bank", "commbank")];
    const { cba } = findSupportedInstitutions(institutions);
    expect(cba?.id).toBe("inst-1");
  });

  it("does NOT match on substring — a name that merely contains an approved name is not a match", () => {
    const institutions = [institution("inst-1", "Commonwealth Bank of Nowhere Real", "XYZ")];
    const { cba } = findSupportedInstitutions(institutions);
    expect(cba).toBeNull();
  });

  it("returns null (not an error) when no live institution matches — acceptable pre-live state", () => {
    const institutions = [institution("inst-anz", "ANZ", "ANZ")];
    const { cba, virgin } = findSupportedInstitutions(institutions);
    expect(cba).toBeNull();
    expect(virgin).toBeNull();
  });

  it("throws rather than silently picking one, when more than one live institution matches the same approved-name allow-list", () => {
    const institutions = [
      institution("inst-cba-a", "Commonwealth Bank", "CBA-A"),
      institution("inst-cba-b", "CommBank", "CBA-B"),
    ];

    expect(() => findSupportedInstitutions(institutions)).toThrow(/ambiguous/i);
  });

  it("never falls back to a closest-looking institution when the exact name is absent", () => {
    const institutions = [institution("inst-1", "Commonwealth Building Society", "CBS")];
    const { cba } = findSupportedInstitutions(institutions);
    expect(cba).toBeNull();
  });
});
