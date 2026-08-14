import { describe, expect, it } from "vitest";
import { FinancialIntelligenceService } from "../financialIntelligenceService.js";
import { StubGateway } from "../stubGateway.js";
import type { IntelligenceRequest, ModelGateway } from "../modelGateway.js";
import type { FinancialFactSheet } from "../factSheet.js";

const factSheet: FinancialFactSheet = {
  budgetPeriod: { startDate: "2026-08-01", endDate: "2026-08-31", percentElapsed: 45 },
  totals: { allocation: "$5,000.00", spent: "$2,000.00", remaining: "$3,000.00", status: "AHEAD", projectedEndOfPeriod: "$4,400.00" },
  buckets: [
    { name: "Lifestyle", allocation: "$800.00", spent: "$620.00", remaining: "$180.00", status: "BEHIND" },
    { name: "Essentials", allocation: "$2,400.00", spent: "$1,100.00", remaining: "$1,300.00", status: "ON_TRACK" },
  ],
};

function makeRequest(overrides: Partial<IntelligenceRequest> = {}): IntelligenceRequest {
  return { type: "COACH_SUMMARY", factSheet, ...overrides };
}

class FakeGateway implements ModelGateway {
  readonly id = "fake";
  constructor(private response: unknown, private shouldThrow = false) {}
  async generateNarrative(): Promise<unknown> {
    if (this.shouldThrow) throw new Error("provider unavailable");
    return this.response;
  }
}

describe("FinancialIntelligenceService", () => {
  it("uses the AI response when it validates against the fact sheet", async () => {
    const gateway = new FakeGateway({ narrative: "You have $3,000.00 remaining out of $5,000.00." });
    const service = new FinancialIntelligenceService(gateway);
    const result = await service.respond(makeRequest());
    expect(result.source).toBe("AI");
    expect(result.narrative).toContain("$3,000.00");
  });

  it("falls back to the deterministic template when the AI response fails schema validation", async () => {
    const gateway = new FakeGateway({ wrongShape: true });
    const service = new FinancialIntelligenceService(gateway);
    const result = await service.respond(makeRequest());
    expect(result.source).toBe("FALLBACK_TEMPLATE");
    expect(result.narrative.length).toBeGreaterThan(0);
  });

  it("falls back when the AI response invents a dollar figure not in the fact sheet (§45)", async () => {
    const gateway = new FakeGateway({ narrative: "You're on track to save an extra $12,345.00 this year!" });
    const service = new FinancialIntelligenceService(gateway);
    const result = await service.respond(makeRequest());
    expect(result.source).toBe("FALLBACK_TEMPLATE");
  });

  it("falls back gracefully when the AI provider throws (outage) — core response is never broken (§44)", async () => {
    const gateway = new FakeGateway(null, true);
    const service = new FinancialIntelligenceService(gateway);
    const result = await service.respond(makeRequest());
    expect(result.source).toBe("FALLBACK_TEMPLATE");
    expect(result.narrative).toContain("$3,000.00");
  });

  it("the stub gateway alone (AI_PROVIDER=stub default) produces a valid, self-consistent narrative", async () => {
    const service = new FinancialIntelligenceService(new StubGateway());
    const result = await service.respond(makeRequest({ type: "ANSWER_QUESTION", question: "Why are we behind on Lifestyle?" }));
    expect(result.narrative.length).toBeGreaterThan(0);
    expect(["AI", "FALLBACK_TEMPLATE"]).toContain(result.source);
  });
});
