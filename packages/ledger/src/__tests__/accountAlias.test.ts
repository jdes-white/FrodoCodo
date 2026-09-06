import { describe, expect, it } from "vitest";
import { deriveDefaultAccountAlias } from "../accountAlias.js";

describe("deriveDefaultAccountAlias (Task 6B source aliases)", () => {
  it("defaults to the plain institution short name", () => {
    expect(deriveDefaultAccountAlias("CBA", "TRANSACTION", [])).toBe("CBA");
    expect(deriveDefaultAccountAlias("Virgin", "CREDIT_CARD", [])).toBe("Virgin");
    expect(deriveDefaultAccountAlias("Amex", "CREDIT_CARD", [])).toBe("Amex");
  });

  it("qualifies with the account type when the plain short name is already taken", () => {
    expect(deriveDefaultAccountAlias("CBA", "SAVINGS", ["CBA"])).toBe("CBA Savings");
  });

  it("falls back to a numbered suffix when even the qualified alias collides", () => {
    expect(deriveDefaultAccountAlias("CBA", "SAVINGS", ["CBA", "CBA Savings"])).toBe("CBA Savings 2");
    expect(deriveDefaultAccountAlias("CBA", "SAVINGS", ["CBA", "CBA Savings", "CBA Savings 2"])).toBe("CBA Savings 3");
  });

  it("never derives an alias from anything other than the institution short name and account type", () => {
    // No provider nickname, account number, or masked-number fragment is
    // ever an input to this function -- its signature structurally cannot
    // accept one.
    const alias = deriveDefaultAccountAlias("CBA", "TRANSACTION", []);
    expect(alias).not.toMatch(/\d{2,}/); // no digit run that could look like an account fragment
  });
});
