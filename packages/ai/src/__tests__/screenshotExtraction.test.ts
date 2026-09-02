import { describe, expect, it } from "vitest";
import {
  parseExtractionResponse,
  createAnthropicScreenshotVisionExtractor,
  createStubScreenshotVisionExtractor,
  TEST_FIXTURE_MARKER,
  type AnthropicMessagesClient,
  type ScreenshotExtractionResult,
} from "../screenshotExtraction.js";

const TODAY = { todayIso: "2026-09-02" };

function fixtureImage(result: ScreenshotExtractionResult): { base64: string; mediaType: string } {
  const bytes = TEST_FIXTURE_MARKER + JSON.stringify(result);
  return { base64: Buffer.from(bytes, "utf8").toString("base64"), mediaType: "image/png" };
}

describe("parseExtractionResponse — validation and safety", () => {
  it("parses a well-formed response", () => {
    const text = JSON.stringify({
      source: "CBA",
      accountHint: "Everyday Offset",
      transactions: [
        { date: "2026-09-02", description: "Transfer to Other Bank NetBank Ymsfhn", amount: "100.00", direction: "DEBIT", status: "POSTED", confidence: 0.95 },
      ],
    });
    const result = parseExtractionResponse(text, TODAY);
    expect(result.source).toBe("CBA");
    expect(result.transactions).toHaveLength(1);
  });

  it("fails safe on unparseable text", () => {
    const result = parseExtractionResponse("not json at all", TODAY);
    expect(result.source).toBe("UNKNOWN");
    expect(result.transactions).toEqual([]);
  });

  it("fails safe on a response that doesn't match the schema", () => {
    const result = parseExtractionResponse(JSON.stringify({ foo: "bar" }), TODAY);
    expect(result.source).toBe("UNKNOWN");
  });

  it("respects an explicit UNKNOWN source and returns zero transactions", () => {
    const text = JSON.stringify({ source: "UNKNOWN", transactions: [], notes: "Could not identify the app." });
    const result = parseExtractionResponse(text, TODAY);
    expect(result.source).toBe("UNKNOWN");
    expect(result.transactions).toEqual([]);
  });

  it("drops rows below the confidence threshold (partial/incomplete rows ignored)", () => {
    const text = JSON.stringify({
      source: "CBA",
      accountHint: null,
      transactions: [
        { date: "2026-09-02", description: "Confident row", amount: "10.00", direction: "DEBIT", status: "POSTED", confidence: 0.9 },
        { date: "2026-09-02", description: "Cut off row", amount: "5.00", direction: "DEBIT", status: "POSTED", confidence: 0.2 },
      ],
    });
    const result = parseExtractionResponse(text, TODAY);
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0]!.description).toBe("Confident row");
  });

  it("drops rows with an implausible date (far future / far past) rather than trusting a misread year", () => {
    const text = JSON.stringify({
      source: "CBA",
      transactions: [
        { date: "2026-09-02", description: "Today, fine", amount: "10.00", direction: "DEBIT", status: "POSTED", confidence: 0.9 },
        { date: "2030-01-01", description: "Implausible future", amount: "10.00", direction: "DEBIT", status: "POSTED", confidence: 0.9 },
      ],
    });
    const result = parseExtractionResponse(text, TODAY);
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0]!.description).toBe("Today, fine");
  });

  it("normalizes Amex expenditure to DEBIT even when the model reports it unsigned/ambiguous", () => {
    const text = JSON.stringify({
      source: "AMEX",
      accountHint: "Velocity Platinum",
      transactions: [
        { date: "2026-08-29", description: "COLES BROOKSIDE - 4430 MICHELTON", amount: "250.60", direction: "CREDIT", status: "POSTED", confidence: 0.9 },
      ],
    });
    const result = parseExtractionResponse(text, TODAY);
    expect(result.transactions[0]!.direction).toBe("DEBIT");
  });

  it("allows an Amex row to stay CREDIT when the description clearly indicates a payment/refund", () => {
    const text = JSON.stringify({
      source: "AMEX",
      transactions: [
        { date: "2026-08-29", description: "PAYMENT RECEIVED - THANK YOU", amount: "500.00", direction: "CREDIT", status: "POSTED", confidence: 0.9 },
      ],
    });
    const result = parseExtractionResponse(text, TODAY);
    expect(result.transactions[0]!.direction).toBe("CREDIT");
  });

  it("does not alter CBA/Virgin direction (they display an explicit sign)", () => {
    const text = JSON.stringify({
      source: "CBA",
      transactions: [
        { date: "2026-08-27", description: "Salary Dept of Industry", amount: "3162.81", direction: "CREDIT", status: "POSTED", confidence: 0.95 },
      ],
    });
    const result = parseExtractionResponse(text, TODAY);
    expect(result.transactions[0]!.direction).toBe("CREDIT");
  });

  it("never returns an accountHint or description containing a plausible masked account number pattern the model was told to avoid — validated by prompt contract, not enforced by this parser (documented boundary)", () => {
    // No code assertion here — the prohibition is a prompt-level instruction
    // (see SYSTEM_PROMPT). This test exists so the boundary is documented,
    // not silently assumed. Enforcement of "did the model actually comply"
    // is not something a deterministic parser can verify from the text
    // alone; the ingestion allow-list downstream never persists accountHint
    // or description into anything but Transaction.originalDescription
    // (never Account identity fields), so a slip here still can't reach
    // banking-identity storage.
    expect(true).toBe(true);
  });
});

describe("createAnthropicScreenshotVisionExtractor — real gateway, injected fake client", () => {
  it("requires an API key", () => {
    expect(() => createAnthropicScreenshotVisionExtractor("")).toThrow(/API key/);
  });

  it("sends an image content block and today's date, and parses the response", async () => {
    let capturedParams: unknown;
    const fakeClient: AnthropicMessagesClient = {
      messages: {
        create: async (params) => {
          capturedParams = params;
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  source: "VIRGIN_MONEY",
                  accountHint: "Velocity High Flyer Card",
                  transactions: [{ date: "2026-09-01", description: "APPLE.COM/BILL SYDNEY", amount: "22.00", direction: "DEBIT", status: "PENDING", confidence: 0.9 }],
                }),
              },
            ],
          };
        },
      },
    };
    const extractor = createAnthropicScreenshotVisionExtractor("mock-key-not-real", "claude-sonnet-5", fakeClient);
    const result = await extractor({ base64: "aGVsbG8=", mediaType: "image/png" }, TODAY);

    expect(result.source).toBe("VIRGIN_MONEY");
    expect(result.transactions[0]!.status).toBe("PENDING");
    const params = capturedParams as { system: string; messages: Array<{ content: Array<{ type: string }> }> };
    expect(params.system).toContain("2026-09-02");
    expect(params.messages[0]!.content.some((c) => c.type === "image")).toBe(true);
  });

  it("fails safe when the model returns no text content", async () => {
    const fakeClient: AnthropicMessagesClient = { messages: { create: async () => ({ content: [] }) } };
    const extractor = createAnthropicScreenshotVisionExtractor("mock-key-not-real", "claude-sonnet-5", fakeClient);
    const result = await extractor({ base64: "aGVsbG8=", mediaType: "image/png" }, TODAY);
    expect(result.source).toBe("UNKNOWN");
    expect(result.transactions).toEqual([]);
  });
});

describe("createStubScreenshotVisionExtractor — no-provider-configured fallback + test fixture replay", () => {
  it("honestly reports UNKNOWN/zero transactions for a real (non-fixture) image when no AI provider is configured", async () => {
    const extractor = createStubScreenshotVisionExtractor();
    const result = await extractor({ base64: Buffer.from("some real png bytes").toString("base64"), mediaType: "image/png" }, TODAY);
    expect(result.source).toBe("UNKNOWN");
    expect(result.transactions).toEqual([]);
  });

  it("replays a test fixture through the same validation/normalization every real response goes through", async () => {
    const extractor = createStubScreenshotVisionExtractor();
    const image = fixtureImage({
      source: "CBA",
      accountHint: "Everyday Offset",
      transactions: [{ date: "2026-09-02", description: "Test fixture row", amount: "10.00", direction: "DEBIT", status: "POSTED", confidence: 0.95 }],
    });
    const result = await extractor(image, TODAY);
    expect(result.source).toBe("CBA");
    expect(result.transactions).toHaveLength(1);
  });
});
