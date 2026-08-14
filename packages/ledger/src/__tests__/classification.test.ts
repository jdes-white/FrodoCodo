import { describe, expect, it } from "vitest";
import {
  classifyDeterministic,
  resolveClassification,
  deriveLearnedMapping,
  DEFAULT_REVIEW_THRESHOLD,
} from "../classification.js";

describe("classifyDeterministic — precedence order (§11)", () => {
  it("a household rule always wins, even over a learned mapping and provider data", () => {
    const result = classifyDeterministic({
      merchantRule: { categoryId: "groceries", ruleId: "rule_1" },
      learnedMapping: { categoryId: "shopping", confidence: 0.9 },
      providerCategory: { categoryId: "retail", confidence: 0.8 },
    });
    expect(result).toEqual({ categoryId: "groceries", source: "RULE", confidence: 1, ruleId: "rule_1" });
  });

  it("falls back to a learned mapping when there is no explicit rule", () => {
    const result = classifyDeterministic({
      learnedMapping: { categoryId: "dining", confidence: 0.85 },
      providerCategory: { categoryId: "food", confidence: 0.7 },
    });
    expect(result?.source).toBe("LEARNED_MAPPING");
  });

  it("falls back to provider enrichment when nothing else is known", () => {
    const result = classifyDeterministic({ providerCategory: { categoryId: "fuel", confidence: 0.65 } });
    expect(result?.source).toBe("PROVIDER");
  });

  it("returns null when there is no deterministic signal at all", () => {
    expect(classifyDeterministic({})).toBeNull();
  });
});

describe("resolveClassification", () => {
  it("auto-classifies from a confident deterministic signal without needing AI", () => {
    const outcome = resolveClassification({ categoryId: "groceries", source: "RULE", confidence: 1 }, null);
    expect(outcome).toEqual({ status: "CLASSIFIED", categoryId: "groceries", source: "RULE", confidence: 1, ruleId: undefined });
  });

  it("uses the AI suggestion only when deterministic confidence is below threshold", () => {
    const outcome = resolveClassification(
      { categoryId: "shopping", source: "PROVIDER", confidence: 0.3 },
      { categoryId: "dining", confidence: 0.75 },
    );
    expect(outcome.status).toBe("CLASSIFIED");
    expect(outcome).toMatchObject({ categoryId: "dining", source: "AI" });
  });

  it("sends a transaction to the review queue when nothing clears the threshold", () => {
    const outcome = resolveClassification(
      { categoryId: "shopping", source: "PROVIDER", confidence: 0.3 },
      { categoryId: "dining", confidence: 0.4 },
      DEFAULT_REVIEW_THRESHOLD,
    );
    expect(outcome.status).toBe("NEEDS_REVIEW");
    if (outcome.status === "NEEDS_REVIEW") {
      // Best guess still surfaces for the UI to pre-fill, but was not auto-applied.
      expect(outcome.bestGuessCategoryId).toBe("dining");
    }
  });

  it("sends to review with no best guess when there is no signal at all", () => {
    const outcome = resolveClassification(null, null);
    expect(outcome).toEqual({ status: "NEEDS_REVIEW", bestGuessCategoryId: undefined, bestGuessSource: undefined, bestGuessConfidence: undefined });
  });
});

describe("deriveLearnedMapping (§12)", () => {
  it("does nothing until the household has corrected a merchant the minimum number of times", () => {
    expect(deriveLearnedMapping([{ categoryId: "dining" }, { categoryId: "dining" }])).toBeNull();
  });

  it("learns a mapping once the household has consistently classified a merchant the same way", () => {
    const mapping = deriveLearnedMapping([
      { categoryId: "dining" },
      { categoryId: "dining" },
      { categoryId: "dining" },
    ]);
    expect(mapping?.categoryId).toBe("dining");
    expect(mapping?.confidence).toBeGreaterThanOrEqual(DEFAULT_REVIEW_THRESHOLD);
  });

  it("picks the majority category when corrections are mixed", () => {
    const mapping = deriveLearnedMapping([
      { categoryId: "dining" },
      { categoryId: "groceries" },
      { categoryId: "dining" },
      { categoryId: "dining" },
    ]);
    expect(mapping?.categoryId).toBe("dining");
  });
});
