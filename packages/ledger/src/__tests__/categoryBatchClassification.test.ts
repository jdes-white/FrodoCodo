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

describe("financial movement integration (categorisation closure pass)", () => {
  const allowed = new Set(["cat_food", "cat_groceries"]);

  it("excludes a confidently-recognised salary credit from the AI batch entirely", () => {
    const items = [item({ key: "1", matchKey: "acme_payroll", direction: "CREDIT", originalDescription: "SALARY - ACME PTY LTD" })];
    const { requests, movementByKey } = planCategorySuggestionBatch(items);
    expect(requests).toHaveLength(0);
    expect(movementByKey.get("1")).toBe("CONFIDENT_NON_SPEND");
  });

  it("finalizes a confident salary credit as EXCLUDED_NON_SPEND, never inventing a spending category", () => {
    const items = [item({ key: "1", matchKey: "acme_payroll", direction: "CREDIT", originalDescription: "SALARY - ACME PTY LTD" })];
    const { deterministicByKey, movementByKey } = planCategorySuggestionBatch(items);
    const outcomes = finalizeCategoryBatch(items, deterministicByKey, new Map(), allowed, movementByKey);
    expect(outcomes.get("1")).toEqual({ status: "EXCLUDED_NON_SPEND" });
  });

  it("excludes an uncertain internal-transfer-looking description from the AI batch, and finalizes it as needing financial-movement review", () => {
    const items = [item({ key: "1", matchKey: "transfer_to_savings", direction: "DEBIT", originalDescription: "TRANSFER TO SAVINGS" })];
    const { requests, deterministicByKey, movementByKey } = planCategorySuggestionBatch(items);
    expect(requests).toHaveLength(0);
    expect(movementByKey.get("1")).toBe("UNCERTAIN_NON_SPEND");
    const outcomes = finalizeCategoryBatch(items, deterministicByKey, new Map(), allowed, movementByKey);
    expect(outcomes.get("1")).toEqual({ status: "NEEDS_FINANCIAL_MOVEMENT_REVIEW" });
  });

  it("does not silently exclude an uncertain transfer — it stays reviewable, not auto-excluded", () => {
    const items = [item({ key: "1", matchKey: "transfer_to_savings", direction: "DEBIT", originalDescription: "TRANSFER TO SAVINGS" })];
    const { deterministicByKey, movementByKey } = planCategorySuggestionBatch(items);
    const outcomes = finalizeCategoryBatch(items, deterministicByKey, new Map(), allowed, movementByKey);
    expect(outcomes.get("1")).not.toEqual({ status: "EXCLUDED_NON_SPEND" });
  });

  it("an explicit household rule always wins over a non-spend-looking description", () => {
    const items = [
      item({
        key: "1",
        matchKey: "transfer_to_savings",
        direction: "DEBIT",
        originalDescription: "TRANSFER TO SAVINGS",
        merchantRule: { categoryId: "cat_groceries", ruleId: "rule_1" },
      }),
    ];
    const { requests, deterministicByKey, movementByKey } = planCategorySuggestionBatch(items);
    expect(requests).toHaveLength(0);
    expect(movementByKey.has("1")).toBe(false);
    const outcomes = finalizeCategoryBatch(items, deterministicByKey, new Map(), allowed, movementByKey);
    const outcome = outcomes.get("1")!;
    expect(outcome.status === "CLASSIFIED" && outcome.categoryId).toBe("cat_groceries");
  });

  it("still requests an AI opinion for an ordinary first-time merchant alongside a movement-flagged one in the same batch", () => {
    const items = [
      item({ key: "1", matchKey: "kfc", direction: "DEBIT", originalDescription: "KFC EVERTON PARK" }),
      item({ key: "2", matchKey: "transfer_to_savings", direction: "DEBIT", originalDescription: "TRANSFER TO SAVINGS" }),
    ];
    const { requests } = planCategorySuggestionBatch(items);
    expect(requests).toHaveLength(1);
    expect(requests[0]!.key).toBe("kfc");
  });

  it("never includes the raw description in an AI request payload", () => {
    const items = [item({ key: "1", matchKey: "kfc", originalDescription: "KFC EVERTON PARK STORE #4471 CARD 1234" })];
    const { requests } = planCategorySuggestionBatch(items);
    expect(requests[0]).toEqual({ key: "kfc", merchantName: "Merchant", amount: "10.00", direction: "DEBIT" });
    expect(JSON.stringify(requests)).not.toContain("EVERTON PARK");
  });
});
