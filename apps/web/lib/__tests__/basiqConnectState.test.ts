import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { signConnectState, verifyConnectState } from "../basiqConnectState";

describe("basiqConnectState (Task 7C — CSRF/mix-up protection for the Basiq Consent UI return)", () => {
  const originalSecret = process.env.AUTH_SECRET;

  beforeEach(() => {
    process.env.AUTH_SECRET = "test-secret-value-not-real";
  });

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = originalSecret;
  });

  it("round-trips a signed payload", async () => {
    const token = await signConnectState({ connectionId: "conn-1", state: "state-abc" });
    const verified = await verifyConnectState(token);
    expect(verified).toEqual({ connectionId: "conn-1", state: "state-abc" });
  });

  it("rejects a tampered token", async () => {
    const token = await signConnectState({ connectionId: "conn-1", state: "state-abc" });
    const tampered = token.slice(0, -2) + (token.at(-2) === "a" ? "b" : "a") + token.at(-1);
    expect(await verifyConnectState(tampered)).toBeNull();
  });

  it("rejects a token signed with a different secret", async () => {
    const token = await signConnectState({ connectionId: "conn-1", state: "state-abc" });
    process.env.AUTH_SECRET = "a-completely-different-secret";
    expect(await verifyConnectState(token)).toBeNull();
  });

  it("rejects garbage input rather than throwing", async () => {
    expect(await verifyConnectState("not-a-jwt")).toBeNull();
    expect(await verifyConnectState("")).toBeNull();
  });
});
