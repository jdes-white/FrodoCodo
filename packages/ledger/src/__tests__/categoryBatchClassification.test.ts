import { describe, it, expect } from "vitest";
import {
  planCategorySuggestionBatch,
  finalizeCategoryBatch,
  AI_CATEGORY_CONFIDENCE_THRESHOLD,
  type BatchClassifiableItem,
} from "../categoryBatchClassification.js";

function item(overrides: Partial<BatchClassifiableItem> & Pick<BatchClassifiableItem, "key" | "matchKey">): BatchClassifiableItem {
  return { merchantName: "Merchant", amount: "10.00", direction: "DEBIT", ...overrides };
}

describe("planCategorySuggestionBatch", () => {
  it("skips a merchant with a confident household rule — no AI request generated", () => {
    const items = [item({ key: "1", matchKey: "kfc", merchantRule: { categoryId: "cat_food", ruleId: "rule_1" } })];
    const { requests, deterministicByKey } = planCategorySuggestionBatch(items);
    expect(requests).toHaveLength(0);
    expect(deterministicByKey.get("1")?.source).toBe("RULE");
  });

  it("skips a merchant with a confident learned mapping — no AI request generated", () => {
    const items = [item({ key: "1", matchKey: "woolworths", learnedMapping: { categoryId: "cat_groceries", confidence: 0.85 } })];
    const { requests } = planCategorySuggestionBatch(items);
    expect(requests).toHaveLength(0);
  });

  it("includes a merchant with no deterministic signal at all", () => {
    const items = [item({ key: "1", matchKey: "kfc" })];
    const { requests } = planCategorySuggestionBatch(items);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ key: "kfc", merchantName: "Merchant" });
  });

  it("includes a merchant whose deterministic confidence is below the review threshold", () => {
    const items = [item({ key: "1", matchKey: "kfc", learnedMapping: { categoryId: "cat_food", confidence: 0.4 } })];
    const { requests } = planCategorySuggestionBatch(items);
    expect(requests).toHaveLength(1);
  });

  it("deduplicates repeated merchants within one batch into a single AI request", () => {
    const items = [
      item({ key: "1", matchKey: "kfc", merchantName: "Kfc Everton Park" }),
      item({ key: "2", matchKey: "kfc", merchantName: "Kfc Everton Park" }),
      item({ key: "3", matchKey: "kfc", merchantName: "Kfc Everton Park" }),
    ];
    const { requests } = planCategorySuggestionBatch(items);
    expect(requests).toHaveLength(1);
    expect(requests[0]!.key).toBe("kfc");
  });

  it("still produces one deterministic entry per item even when merchants are deduplicated for AI", () => {
    const items = [item({ key: "1", matchKey: "kfc" }), item({ key: "2", matchKey: "kfc" })];
    const { deterministicByKey } = planCategorySuggestionBatch(items);
    expect(deterministicByKey.size).toBe(2);
  });
});

describe("finalizeCategoryBatch", () => {
  const allowed = new Set(["cat_food", "cat_groceries"]);

  it("auto-assigns at exactly the 0.80 threshold", () => {
    const items = [item({ key: "1", matchKey: "kfc" })];
    const { deterministicByKey } = planCategorySuggestionBatch(items);
    const answers = new Map([["kfc", { categoryId: "cat_food", confidence: 0.8 }]]);
    const outcomes = finalizeCategoryBatch(items, deterministicByKey, answers, allowed);
    const outcome = outcomes.get("1")!;
    expect(outcome.status).toBe("CLASSIFIED");
    expect(outcome.status === "CLASSIFIED" && outcome.categoryId).toBe("cat_food");
    expect(outcome.status === "CLASSIFIED" && outcome.source).toBe("AI");
  });

  it("leaves a transaction unresolved when AI confidence is just below 0.80", () => {
    const items = [item({ key: "1", matchKey: "kfc" })];
    const { deterministicByKey } = planCategorySuggestionBatch(items);
    const answers = new Map([["kfc", { categoryId: "cat_food", confidence: 0.79 }]]);
    const outcomes = finalizeCategoryBatch(items, deterministicByKey, answers, allowed);
    expect(outcomes.get("1")!.status).toBe("NEEDS_REVIEW");
  });

  it("rejects an invented/unlisted category id even at high confidence", () => {
    const items = [item({ key: "1", matchKey: "kfc" })];
    const { deterministicByKey } = planCategorySuggestionBatch(items);
    const answers = new Map([["kfc", { categoryId: "cat_does_not_exist", confidence: 0.99 }]]);
    const outcomes = finalizeCategoryBatch(items, deterministicByKey, answers, allowed);
    expect(outcomes.get("1")!.status).toBe("NEEDS_REVIEW");
  });

  it("falls back safely when the AI answer for a merchant is entirely missing", () => {
    const items = [item({ key: "1", matchKey: "kfc" })];
    const { deterministicByKey } = planCategorySuggestionBatch(items);
    const outcomes = finalizeCategoryBatch(items, deterministicByKey, new Map(), allowed);
    expect(outcomes.get("1")!.status).toBe("NEEDS_REVIEW");
  });

  it("falls back safely when the AI answer for a merchant is explicitly null", () => {
    const items = [item({ key: "1", matchKey: "kfc" })];
    const { deterministicByKey } = planCategorySuggestionBatch(items);
    const answers = new Map<string, { categoryId: string; confidence: number } | null>([["kfc", null]]);
    const outcomes = finalizeCategoryBatch(items, deterministicByKey, answers, allowed);
    expect(outcomes.get("1")!.status).toBe("NEEDS_REVIEW");
  });

  it("reuses one AI answer across every item sharing the same merchant", () => {
    const items = [
      item({ key: "1", matchKey: "kfc" }),
      item({ key: "2", matchKey: "kfc" }),
      item({ key: "3", matchKey: "kfc" }),
    ];
    const { deterministicByKey } = planCategorySuggestionBatch(items);
    const answers = new Map([["kfc", { categoryId: "cat_food", confidence: 0.9 }]]);
    const outcomes = finalizeCategoryBatch(items, deterministicByKey, answers, allowed);
    for (const key of ["1", "2", "3"]) {
      const outcome = outcomes.get(key)!;
      expect(outcome.status).toBe("CLASSIFIED");
      expect(outcome.status === "CLASSIFIED" && outcome.categoryId).toBe("cat_food");
    }
  });

  it("keeps a confident household rule authoritative over a confident AI answer for the same merchant", () => {
    const items = [item({ key: "1", matchKey: "kfc", merchantRule: { categoryId: "cat_groceries", ruleId: "rule_1" } })];
    const { deterministicByKey } = planCategorySuggestionBatch(items);
    // Even though this merchant was already confident (so planCategorySuggestionBatch
    // wouldn't have requested it), simulate a stray AI answer to verify priority holds.
    const answers = new Map([["kfc", { categoryId: "cat_food", confidence: 0.99 }]]);
    const outcomes = finalizeCategoryBatch(items, deterministicByKey, answers, allowed);
    const outcome = outcomes.get("1")!;
    expect(outcome.status === "CLASSIFIED" && outcome.categoryId).toBe("cat_groceries");
    expect(outcome.status === "CLASSIFIED" && outcome.source).toBe("RULE");
  });

  it("exposes the shared threshold constant used for auto-allocation", () => {
    expect(AI_CATEGORY_CONFIDENCE_THRESHOLD).toBe(0.8);
  });
});
