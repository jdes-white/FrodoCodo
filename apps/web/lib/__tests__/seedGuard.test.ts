import { describe, expect, it } from "vitest";
import { isSeedingAllowed } from "../seedGuard";

describe("isSeedingAllowed", () => {
  it("is disabled when NODE_ENV is production", () => {
    expect(isSeedingAllowed("production")).toBe(false);
  });

  it("is enabled for development, test, and unset NODE_ENV", () => {
    expect(isSeedingAllowed("development")).toBe(true);
    expect(isSeedingAllowed("test")).toBe(true);
    expect(isSeedingAllowed(undefined)).toBe(true);
  });
});
