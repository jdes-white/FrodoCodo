import { describe, expect, it } from "vitest";
import {
  parseCategorySuggestionResponse,
  diagnoseCategorySuggestionResponse,
  createAnthropicCategorySuggestionExtractor,
  createStubCategorySuggestionExtractor,
  type CategorySuggestionInput,
  type AllowedCategoryOption,
} from "../categorySuggestion.js";
import type { AnthropicMessagesClient } from "../screenshotExtraction.js";

const ITEMS: CategorySuggestionInput[] = [
  { key: "kfc", merchantName: "Kfc Everton Park", amount: "18.50", direction: "DEBIT" },
  { key: "woolworths", merchantName: "Woolworths", amount: "142.30", direction: "DEBIT" },
];

const CATEGORIES: AllowedCategoryOption[] = [
  { id: "cat_food", name: "Food & Dining" },
  { id: "cat_groceries", name: "Groceries" },
];

describe("parseCategorySuggestionResponse — validation and safety", () => {
  it("parses a well-formed multi-item response", () => {
    const text = JSON.stringify({
      suggestions: [
        { key: "kfc", categoryId: "cat_food", confidence: 0.92 },
        { key: "woolworths", categoryId: "cat_groceries", confidence: 0.97 },
      ],
    });
    const result = parseCategorySuggestionResponse(text, ITEMS, CATEGORIES);
    expect(result.get("kfc")).toEqual({ categoryId: "cat_food", confidence: 0.92 });
    expect(result.get("woolworths")).toEqual({ categoryId: "cat_groceries", confidence: 0.97 });
  });

  it("always has one entry per input key, defaulting to null", () => {
    const result = parseCategorySuggestionResponse(JSON.stringify({ suggestions: [] }), ITEMS, CATEGORIES);
    expect(result.size).toBe(2);
    expect(result.get("kfc")).toBeNull();
    expect(result.get("woolworths")).toBeNull();
  });

  it("rejects an invented/unlisted category id — the item stays null, other items unaffected", () => {
    const text = JSON.stringify({
      suggestions: [
        { key: "kfc", categoryId: "cat_totally_made_up", confidence: 0.99 },
        { key: "woolworths", categoryId: "cat_groceries", confidence: 0.9 },
      ],
    });
    const result = parseCategorySuggestionResponse(text, ITEMS, CATEGORIES);
    expect(result.get("kfc")).toBeNull();
    expect(result.get("woolworths")).toEqual({ categoryId: "cat_groceries", confidence: 0.9 });
  });

  it("ignores an unrecognized/hallucinated key", () => {
    const text = JSON.stringify({ suggestions: [{ key: "not-a-real-item", categoryId: "cat_food", confidence: 0.9 }] });
    const result = parseCategorySuggestionResponse(text, ITEMS, CATEGORIES);
    expect(result.get("kfc")).toBeNull();
  });

  it("falls back safely (all null) on malformed JSON", () => {
    const result = parseCategorySuggestionResponse("not json at all", ITEMS, CATEGORIES);
    expect(result.get("kfc")).toBeNull();
    expect(result.get("woolworths")).toBeNull();
  });

  it("falls back safely (all null) on a response that doesn't match the top-level schema", () => {
    const result = parseCategorySuggestionResponse(JSON.stringify({ foo: "bar" }), ITEMS, CATEGORIES);
    expect(result.get("kfc")).toBeNull();
  });

  it("drops an individual malformed row without affecting the rest of the batch", () => {
    const text = JSON.stringify({
      suggestions: [
        { key: "kfc", categoryId: "cat_food" /* missing confidence */ },
        { key: "woolworths", categoryId: "cat_groceries", confidence: 0.9 },
      ],
    });
    const result = parseCategorySuggestionResponse(text, ITEMS, CATEGORIES);
    expect(result.get("kfc")).toBeNull();
    expect(result.get("woolworths")).toEqual({ categoryId: "cat_groceries", confidence: 0.9 });
  });

  it("treats an explicit null categoryId as the model honestly declining", () => {
    const text = JSON.stringify({ suggestions: [{ key: "kfc", categoryId: null, confidence: 0.1 }] });
    const result = parseCategorySuggestionResponse(text, ITEMS, CATEGORIES);
    expect(result.get("kfc")).toBeNull();
  });
});

describe("diagnoseCategorySuggestionResponse — production failure-mode breakdown", () => {
  it("reports jsonParsed:false for unparseable text (distinct from every other failure mode)", () => {
    const d = diagnoseCategorySuggestionResponse("not json at all", ITEMS, CATEGORIES);
    expect(d).toMatchObject({ jsonParsed: false, schemaValid: false, rowCount: 0, validRowCount: 0 });
  });

  it("reports jsonParsed:true, schemaValid:false for valid JSON that doesn't match the top-level shape", () => {
    const d = diagnoseCategorySuggestionResponse(JSON.stringify({ foo: "bar" }), ITEMS, CATEGORIES);
    expect(d).toMatchObject({ jsonParsed: true, schemaValid: false, rowCount: 0 });
  });

  it("counts a truncated response (valid JSON prefix, cut off mid-array) as a parse failure, not a confidence problem", () => {
    // Simulates a response cut off by max_tokens: the object never closes.
    const truncated = '{"suggestions": [{"key": "kfc", "categoryId": "cat_food", "confidence": 0.9}, {"key": "woolwo';
    const d = diagnoseCategorySuggestionResponse(truncated, ITEMS, CATEGORIES);
    expect(d.jsonParsed).toBe(false);
  });

  it("distinguishes unknown-key, null-category, and invalid-category rejections from genuinely valid rows", () => {
    const text = JSON.stringify({
      suggestions: [
        { key: "kfc", categoryId: "cat_food", confidence: 0.9 }, // valid, >= threshold
        { key: "woolworths", categoryId: "cat_groceries", confidence: 0.5 }, // valid, below threshold
        { key: "not-a-real-item", categoryId: "cat_food", confidence: 0.9 }, // unknown key
      ],
    });
    const d = diagnoseCategorySuggestionResponse(text, ITEMS, CATEGORIES, 0.8);
    expect(d).toMatchObject({
      jsonParsed: true,
      schemaValid: true,
      rowCount: 3,
      unknownKeyCount: 1,
      validRowCount: 2,
      validRowsAtOrAboveThresholdCount: 1,
    });
  });

  it("counts an invented category id separately from a null (declined) category", () => {
    const text = JSON.stringify({
      suggestions: [
        { key: "kfc", categoryId: "cat_invented", confidence: 0.9 },
        { key: "woolworths", categoryId: null, confidence: 0.2 },
      ],
    });
    const d = diagnoseCategorySuggestionResponse(text, ITEMS, CATEGORIES);
    expect(d).toMatchObject({ invalidCategoryIdCount: 1, nullCategoryCount: 1, validRowCount: 0 });
  });
});

describe("createAnthropicCategorySuggestionExtractor — real gateway, injected fake client", () => {
  it("requires an API key", () => {
    expect(() => createAnthropicCategorySuggestionExtractor("")).toThrow(/API key/);
  });

  it("sends only merchant name, amount, and direction — never sensitive fields — and parses the response", async () => {
    let capturedParams: unknown;
    const fakeClient: AnthropicMessagesClient = {
      messages: {
        create: async (params) => {
          capturedParams = params;
          // "0" is the short synthetic key for the first item (ITEMS[0], "kfc") — see the
          // "uses short synthetic keys" test below for why real keys are never sent as-is.
          return {
            content: [{ type: "text", text: JSON.stringify({ suggestions: [{ key: "0", categoryId: "cat_food", confidence: 0.9 }] }) }],
          };
        },
      },
    };
    const extractor = createAnthropicCategorySuggestionExtractor("mock-key-not-real", "claude-sonnet-5", fakeClient);
    const result = await extractor(ITEMS, CATEGORIES);

    expect(result.get("kfc")).toEqual({ categoryId: "cat_food", confidence: 0.9 });

    const params = capturedParams as { system: string; messages: Array<{ content: string }> };
    const sentPayload = JSON.parse(params.messages[0]!.content);
    expect(sentPayload).toEqual({
      transactions: [
        { key: "0", merchantName: "Kfc Everton Park", amount: "18.50", direction: "DEBIT" },
        { key: "1", merchantName: "Woolworths", amount: "142.30", direction: "DEBIT" },
      ],
    });
    // The user-message payload (the actual per-transaction data, as opposed
    // to the fixed category-list system prompt) must never carry anything
    // beyond key/merchantName/amount/direction.
    const sentPayloadText = params.messages[0]!.content;
    for (const forbidden of ["account", "bsb", "balance", "card", "provider", "household", "description"]) {
      expect(sentPayloadText.toLowerCase()).not.toContain(forbidden);
    }
  });

  it("uses short synthetic keys instead of the real (potentially long) correlation key — the confirmed production defect", async () => {
    // Production evidence: a real merchant match key derived from a long,
    // real-world transfer description ("Transfer To S Choki Payid Phone
    // From Commbank App Kirsten White Cleaning" squished to ~60 chars) —
    // echoing keys that long back for every row in a 41-item batch pushed
    // the response past max_tokens and truncated it entirely (stop_reason
    // "max_tokens"), producing zero usable answers for the WHOLE batch.
    const longKeyItem: CategorySuggestionInput = {
      key: "transfertoschokipayidphonefromcommbankappkirstenwhitecleaning",
      merchantName: "Transfer To S Choki",
      amount: "150.00",
      direction: "DEBIT",
    };
    let capturedPayload: { transactions: Array<{ key: string }> } | undefined;
    const fakeClient: AnthropicMessagesClient = {
      messages: {
        create: async (params) => {
          capturedPayload = JSON.parse((params as { messages: Array<{ content: string }> }).messages[0]!.content);
          return { content: [{ type: "text", text: JSON.stringify({ suggestions: [{ key: "0", categoryId: "cat_food", confidence: 0.9 }] }) }] };
        },
      },
    };
    const extractor = createAnthropicCategorySuggestionExtractor("mock-key-not-real", "claude-sonnet-5", fakeClient);
    const result = await extractor([longKeyItem], CATEGORIES);

    // The long real key is never sent to the model...
    expect(capturedPayload!.transactions[0]!.key).toBe("0");
    expect(capturedPayload!.transactions.some((t) => t.key === longKeyItem.key)).toBe(false);
    // ...but the caller still gets its answer back under the real key.
    expect(result.get(longKeyItem.key)).toEqual({ categoryId: "cat_food", confidence: 0.9 });
  });

  it("never invents a category id outside the allowed list, even if the model does", async () => {
    const fakeClient: AnthropicMessagesClient = {
      messages: {
        create: async () => ({
          content: [{ type: "text", text: JSON.stringify({ suggestions: [{ key: "0", categoryId: "cat_invented", confidence: 0.99 }] }) }],
        }),
      },
    };
    const extractor = createAnthropicCategorySuggestionExtractor("mock-key-not-real", "claude-sonnet-5", fakeClient);
    const result = await extractor(ITEMS, CATEGORIES);
    expect(result.get("kfc")).toBeNull();
  });

  it("degrades to no-suggestions (never throws) when the Anthropic call itself fails", async () => {
    const fakeClient: AnthropicMessagesClient = {
      messages: {
        create: async () => {
          throw new Error("simulated network/API failure");
        },
      },
    };
    const extractor = createAnthropicCategorySuggestionExtractor("mock-key-not-real", "claude-sonnet-5", fakeClient);
    const result = await extractor(ITEMS, CATEGORIES);
    expect(result.get("kfc")).toBeNull();
    expect(result.get("woolworths")).toBeNull();
  });

  it("degrades to no-suggestions when the model returns no text content", async () => {
    const fakeClient: AnthropicMessagesClient = { messages: { create: async () => ({ content: [] }) } };
    const extractor = createAnthropicCategorySuggestionExtractor("mock-key-not-real", "claude-sonnet-5", fakeClient);
    const result = await extractor(ITEMS, CATEGORIES);
    expect(result.get("kfc")).toBeNull();
  });

  it("short-circuits without calling the model for an empty item or category list", async () => {
    let called = false;
    const fakeClient: AnthropicMessagesClient = {
      messages: { create: async () => { called = true; return { content: [] }; } },
    };
    const extractor = createAnthropicCategorySuggestionExtractor("mock-key-not-real", "claude-sonnet-5", fakeClient);
    await extractor([], CATEGORIES);
    await extractor(ITEMS, []);
    expect(called).toBe(false);
  });
});

describe("createStubCategorySuggestionExtractor — no-provider-configured fallback", () => {
  it("always reports no suggestions, never fabricating a category", async () => {
    const extractor = createStubCategorySuggestionExtractor();
    const result = await extractor(ITEMS, CATEGORIES);
    expect(result.get("kfc")).toBeNull();
    expect(result.get("woolworths")).toBeNull();
  });
});
