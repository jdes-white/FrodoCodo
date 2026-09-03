import { describe, expect, it } from "vitest";
import {
  parseCategorySuggestionResponse,
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
          return {
            content: [
              { type: "text", text: JSON.stringify({ suggestions: [{ key: "kfc", categoryId: "cat_food", confidence: 0.9 }] }) },
            ],
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
        { key: "kfc", merchantName: "Kfc Everton Park", amount: "18.50", direction: "DEBIT" },
        { key: "woolworths", merchantName: "Woolworths", amount: "142.30", direction: "DEBIT" },
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

  it("never invents a category id outside the allowed list, even if the model does", async () => {
    const fakeClient: AnthropicMessagesClient = {
      messages: {
        create: async () => ({
          content: [{ type: "text", text: JSON.stringify({ suggestions: [{ key: "kfc", categoryId: "cat_invented", confidence: 0.99 }] }) }],
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
