import { describe, expect, it } from "vitest";
import { paceStatusLabel } from "@frodocodo/domain";
import { FinancialIntelligenceService } from "../financialIntelligenceService.js";
import { StubGateway } from "../stubGateway.js";
import type { IntelligenceRequest, ModelGateway } from "../modelGateway.js";
import type { FinancialFactSheet } from "../factSheet.js";

const factSheet: FinancialFactSheet = {
  budgetPeriod: { startDate: "2026-08-01", endDate: "2026-08-31", percentElapsed: 45 },
  totals: { allocation: "$5,000.00", spent: "$2,000.00", remaining: "$3,000.00", status: "AHEAD_OF_PLAN", projectedEndOfPeriod: "$4,400.00" },
  buckets: [
    { name: "Lifestyle", allocation: "$800.00", spent: "$620.00", remaining: "$180.00", status: "OVER_PACE" },
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

  it("answers a question with the answer itself, not a 'Regarding \"...\":' preamble", async () => {
    const service = new FinancialIntelligenceService(new StubGateway());
    const result = await service.respond(makeRequest({ type: "ANSWER_QUESTION", question: "Why are we behind on Lifestyle?" }));
    expect(result.narrative.startsWith("Regarding")).toBe(false);
  });
});

/**
 * Guards against the confirmed inversion bug (a BEHIND/overspending bucket
 * described as "running ahead of its expected pace", and the mirror case)
 * for every one of the canonical PaceStatus tiers — not just the two this
 * bug happened to be found in. The stub gateway's wording now comes
 * straight from `paceStatusLabel`, so these are really testing "the
 * narrative names the exact label the status pill shows" rather than a
 * hand-maintained parallel vocabulary that could drift again.
 */
describe("StubGateway wording never contradicts the underlying PaceStatus", () => {
  function factSheetWithBucketStatus(status: FinancialFactSheet["buckets"][number]["status"]): FinancialFactSheet {
    return {
      budgetPeriod: { startDate: "2026-08-01", endDate: "2026-08-31", percentElapsed: 50 },
      totals: { allocation: "$5,000.00", spent: "$2,500.00", remaining: "$2,500.00", status: "ON_TRACK" },
      buckets: [{ name: "Lifestyle", allocation: "$800.00", spent: "$620.00", remaining: "$180.00", status }],
    };
  }

  async function narrativeFor(status: FinancialFactSheet["buckets"][number]["status"]): Promise<string> {
    const result = (await new StubGateway().generateNarrative({ type: "COACH_SUMMARY", factSheet: factSheetWithBucketStatus(status) })) as {
      narrative: string;
    };
    return result.narrative;
  }

  it("an OVER_PACE (overspending) bucket is never described as ahead", async () => {
    const narrative = await narrativeFor("OVER_PACE");
    expect(narrative).toContain("Lifestyle is over pace");
    expect(narrative.toLowerCase()).not.toContain("ahead");
  });

  it("a SLIGHTLY_OVER_PACE bucket is never described as ahead or comfortable", async () => {
    const narrative = await narrativeFor("SLIGHTLY_OVER_PACE");
    expect(narrative).toContain("Lifestyle is slightly over pace");
    expect(narrative.toLowerCase()).not.toContain("ahead");
    expect(narrative.toLowerCase()).not.toContain("comfortabl");
  });

  it("a COMFORTABLY_AHEAD bucket is never described as over pace or behind", async () => {
    const narrative = await narrativeFor("COMFORTABLY_AHEAD");
    expect(narrative).toContain("Lifestyle is comfortably on track");
    expect(narrative.toLowerCase()).not.toContain("over pace");
    expect(narrative.toLowerCase()).not.toContain("behind");
  });

  it("an AHEAD_OF_PLAN bucket is never described as over pace or behind", async () => {
    const narrative = await narrativeFor("AHEAD_OF_PLAN");
    expect(narrative).toContain("Lifestyle is ahead of plan");
    expect(narrative.toLowerCase()).not.toContain("over pace");
    expect(narrative.toLowerCase()).not.toContain("behind");
  });

  it("an ON_TRACK bucket isn't singled out by name at all (only non-ON_TRACK buckets are 'notable')", async () => {
    const narrative = await narrativeFor("ON_TRACK");
    expect(narrative).not.toContain("Lifestyle is");
  });

  it("the household total's own status phrase always matches paceStatusLabel exactly, for every tier", async () => {
    const statuses: FinancialFactSheet["totals"]["status"][] = [
      "COMFORTABLY_AHEAD",
      "AHEAD_OF_PLAN",
      "ON_TRACK",
      "SLIGHTLY_OVER_PACE",
      "OVER_PACE",
    ];
    for (const status of statuses) {
      const sheet = factSheetWithBucketStatus("ON_TRACK");
      sheet.totals.status = status;
      const result = (await new StubGateway().generateNarrative({ type: "COACH_SUMMARY", factSheet: sheet })) as { narrative: string };
      expect(result.narrative).toContain(`spending is ${paceStatusLabel(status).toLowerCase()}`);
    }
  });
});
