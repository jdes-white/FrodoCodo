import { describe, expect, it } from "vitest";
import { classifyImportBatchOutcome, type ImportBatchOutcomeRow } from "../importBatchOutcome.js";

function row(overrides: Partial<ImportBatchOutcomeRow> = {}): ImportBatchOutcomeRow {
  return {
    categoryId: null,
    isExcludedFromBudget: false,
    needsFinancialMovementReview: false,
    possibleDuplicateOfId: null,
    needsExtractionReview: false,
    ...overrides,
  };
}

describe("classifyImportBatchOutcome", () => {
  it("categorised transaction status survives reconstruction", () => {
    expect(classifyImportBatchOutcome(row({ categoryId: "cat_groceries" }))).toBe("CATEGORISED");
  });

  it("an uncategorised row with no other flag needs a category", () => {
    expect(classifyImportBatchOutcome(row())).toBe("CATEGORY_REVIEW");
  });

  it("excluded non-spend (confident income/transfer) survives reconstruction", () => {
    expect(classifyImportBatchOutcome(row({ isExcludedFromBudget: true }))).toBe("EXCLUDED_NON_SPEND");
  });

  it("financial-movement-review survives reconstruction", () => {
    expect(classifyImportBatchOutcome(row({ needsFinancialMovementReview: true }))).toBe("FINANCIAL_MOVEMENT_REVIEW");
  });

  it("possible-duplicate survives reconstruction", () => {
    expect(classifyImportBatchOutcome(row({ possibleDuplicateOfId: "tx_other" }))).toBe("POSSIBLE_DUPLICATE");
  });

  it("low-confidence extraction survives reconstruction", () => {
    expect(classifyImportBatchOutcome(row({ needsExtractionReview: true }))).toBe("LOW_CONFIDENCE_EXTRACTION");
  });

  it("extraction uncertainty takes precedence over every other simultaneous flag", () => {
    expect(
      classifyImportBatchOutcome(
        row({
          needsExtractionReview: true,
          possibleDuplicateOfId: "tx_other",
          needsFinancialMovementReview: true,
          isExcludedFromBudget: true,
          categoryId: "cat_groceries",
        }),
      ),
    ).toBe("LOW_CONFIDENCE_EXTRACTION");
  });

  it("duplicate uncertainty takes precedence over categorisation/financial-movement/exclusion", () => {
    expect(
      classifyImportBatchOutcome(
        row({ possibleDuplicateOfId: "tx_other", needsFinancialMovementReview: true, isExcludedFromBudget: true, categoryId: "cat_groceries" }),
      ),
    ).toBe("POSSIBLE_DUPLICATE");
  });

  it("a later recategorisation changes the bucket without any outcome field being written", () => {
    const beforeCorrection = row();
    expect(classifyImportBatchOutcome(beforeCorrection)).toBe("CATEGORY_REVIEW");
    const afterCorrection = { ...beforeCorrection, categoryId: "cat_groceries" };
    expect(classifyImportBatchOutcome(afterCorrection)).toBe("CATEGORISED");
  });
});
