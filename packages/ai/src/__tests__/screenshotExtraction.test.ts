import { describe, expect, it } from "vitest";
import {
  parseExtractionResponse,
  createAnthropicScreenshotVisionExtractor,
  createStubScreenshotVisionExtractor,
  TEST_FIXTURE_MARKER,
  type AnthropicMessagesClient,
  type ScreenshotSource,
} from "../screenshotExtraction.js";

function context(knownSource: ScreenshotSource = "CBA") {
  return { todayIso: "2026-09-02", knownSource };
}

function fixtureImage(payload: Record<string, unknown>): { base64: string; mediaType: string } {
  const bytes = TEST_FIXTURE_MARKER + JSON.stringify(payload);
  return { base64: Buffer.from(bytes, "utf8").toString("base64"), mediaType: "image/png" };
}

describe("parseExtractionResponse — validation and safety", () => {
  it("parses a well-formed response", () => {
    const text = JSON.stringify({
      accountHint: "Everyday Offset",
      transactions: [
        { date: "2026-09-02", description: "Transfer to Other Bank NetBank Ymsfhn", amount: "100.00", direction: "DEBIT", status: "POSTED", confidence: 0.95 },
      ],
    });
    const result = parseExtractionResponse(text, context());
    expect(result.status).toBe("OK");
    if (result.status !== "OK") throw new Error("unreachable");
    expect(result.transactions).toHaveLength(1);
    expect(result.unparseableRowCount).toBe(0);
  });

  it("fails safe (EXTRACTION_FAILED) on unparseable text, rather than a silent zero-result", () => {
    const result = parseExtractionResponse("not json at all", context());
    expect(result.status).toBe("EXTRACTION_FAILED");
  });

  it("fails safe (EXTRACTION_FAILED) on a response that doesn't match the schema", () => {
    const result = parseExtractionResponse(JSON.stringify({ foo: "bar" }), context());
    expect(result.status).toBe("EXTRACTION_FAILED");
  });

  it("no longer drops a low-confidence row — it is kept and flagged needsReview instead", () => {
    const text = JSON.stringify({
      accountHint: null,
      transactions: [
        { date: "2026-09-02", description: "Confident row", amount: "10.00", direction: "DEBIT", status: "POSTED", confidence: 0.9 },
        { date: "2026-09-02", description: "Uncertain but plausible row", amount: "5.00", direction: "DEBIT", status: "POSTED", confidence: 0.2 },
      ],
    });
    const result = parseExtractionResponse(text, context());
    expect(result.status).toBe("OK");
    if (result.status !== "OK") throw new Error("unreachable");
    expect(result.transactions).toHaveLength(2);
    expect(result.transactions.find((t) => t.description === "Confident row")!.needsReview).toBe(false);
    expect(result.transactions.find((t) => t.description === "Uncertain but plausible row")!.needsReview).toBe(true);
    expect(result.unparseableRowCount).toBe(0);
  });

  it("rejects a row with an implausible date (far future / far past) as unparseable rather than trusting a misread year", () => {
    const text = JSON.stringify({
      transactions: [
        { date: "2026-09-02", description: "Today, fine", amount: "10.00", direction: "DEBIT", status: "POSTED", confidence: 0.9 },
        { date: "2030-01-01", description: "Implausible future", amount: "10.00", direction: "DEBIT", status: "POSTED", confidence: 0.9 },
      ],
    });
    const result = parseExtractionResponse(text, context());
    expect(result.status).toBe("OK");
    if (result.status !== "OK") throw new Error("unreachable");
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0]!.description).toBe("Today, fine");
    // The rejected row is counted, never silently absorbed.
    expect(result.unparseableRowCount).toBe(1);
  });

  it("counts a schema-invalid row (e.g. garbled amount) as unparseable instead of failing the whole response", () => {
    const text = JSON.stringify({
      transactions: [
        { date: "2026-09-02", description: "Good row", amount: "10.00", direction: "DEBIT", status: "POSTED", confidence: 0.9 },
        { date: "2026-09-02", description: "Garbled amount", amount: "not-a-number", direction: "DEBIT", status: "POSTED", confidence: 0.9 },
      ],
    });
    const result = parseExtractionResponse(text, context());
    expect(result.status).toBe("OK");
    if (result.status !== "OK") throw new Error("unreachable");
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0]!.description).toBe("Good row");
    expect(result.unparseableRowCount).toBe(1);
  });

  it("surfaces a visibleRowCount/transactions-length mismatch as unparseableRowCount", () => {
    const text = JSON.stringify({
      visibleRowCount: 3,
      transactions: [{ date: "2026-09-02", description: "Only one structured", amount: "10.00", direction: "DEBIT", status: "POSTED", confidence: 0.9 }],
    });
    const result = parseExtractionResponse(text, context());
    expect(result.status).toBe("OK");
    if (result.status !== "OK") throw new Error("unreachable");
    expect(result.transactions).toHaveLength(1);
    expect(result.visibleRowCount).toBe(3);
    // 2 rows the model saw but never even attempted to structure.
    expect(result.unparseableRowCount).toBe(2);
  });

  it("defaults visibleRowCount to the structured row count when the model omits it, so old-shaped fixtures still report zero unparseable rows", () => {
    const text = JSON.stringify({
      transactions: [{ date: "2026-09-02", description: "Row", amount: "10.00", direction: "DEBIT", status: "POSTED", confidence: 0.9 }],
    });
    const result = parseExtractionResponse(text, context());
    expect(result.status).toBe("OK");
    if (result.status !== "OK") throw new Error("unreachable");
    expect(result.visibleRowCount).toBe(1);
    expect(result.unparseableRowCount).toBe(0);
  });

  it("normalizes Amex expenditure to DEBIT even when the model reports it unsigned/ambiguous", () => {
    const text = JSON.stringify({
      accountHint: "Velocity Platinum",
      transactions: [
        { date: "2026-08-29", description: "COLES BROOKSIDE - 4430 MICHELTON", amount: "250.60", direction: "CREDIT", status: "POSTED", confidence: 0.9 },
      ],
    });
    const result = parseExtractionResponse(text, context("AMEX"));
    expect(result.status).toBe("OK");
    if (result.status !== "OK") throw new Error("unreachable");
    expect(result.transactions[0]!.direction).toBe("DEBIT");
  });

  it("allows an Amex row to stay CREDIT when the description clearly indicates a payment/refund", () => {
    const text = JSON.stringify({
      transactions: [{ date: "2026-08-29", description: "PAYMENT RECEIVED - THANK YOU", amount: "500.00", direction: "CREDIT", status: "POSTED", confidence: 0.9 }],
    });
    const result = parseExtractionResponse(text, context("AMEX"));
    expect(result.status).toBe("OK");
    if (result.status !== "OK") throw new Error("unreachable");
    expect(result.transactions[0]!.direction).toBe("CREDIT");
  });

  it("does not alter CBA/Virgin direction (they display an explicit sign)", () => {
    const text = JSON.stringify({
      transactions: [{ date: "2026-08-27", description: "Salary Dept of Industry", amount: "3162.81", direction: "CREDIT", status: "POSTED", confidence: 0.95 }],
    });
    const result = parseExtractionResponse(text, context("CBA"));
    expect(result.status).toBe("OK");
    if (result.status !== "OK") throw new Error("unreachable");
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

  it("tells the model the known source (never asks it to guess), sends the image, and parses the response", async () => {
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
    const result = await extractor({ base64: "aGVsbG8=", mediaType: "image/png" }, context("VIRGIN_MONEY"));

    expect(result.status).toBe("OK");
    if (result.status !== "OK") throw new Error("unreachable");
    expect(result.transactions[0]!.status).toBe("PENDING");
    const params = capturedParams as { system: string; messages: Array<{ content: Array<{ type: string }> }> };
    expect(params.system).toContain("2026-09-02");
    expect(params.system).toContain("Virgin Money");
    expect(params.messages[0]!.content.some((c) => c.type === "image")).toBe(true);
  });

  it("fails safe when the model returns no text content", async () => {
    const fakeClient: AnthropicMessagesClient = { messages: { create: async () => ({ content: [] }) } };
    const extractor = createAnthropicScreenshotVisionExtractor("mock-key-not-real", "claude-sonnet-5", fakeClient);
    const result = await extractor({ base64: "aGVsbG8=", mediaType: "image/png" }, context());
    expect(result.status).toBe("EXTRACTION_FAILED");
  });
});

describe("createStubScreenshotVisionExtractor — no-provider-configured fallback + test fixture replay", () => {
  it("honestly reports EXTRACTION_FAILED for a real (non-fixture) image when no AI provider is configured", async () => {
    const extractor = createStubScreenshotVisionExtractor();
    const result = await extractor({ base64: Buffer.from("some real png bytes").toString("base64"), mediaType: "image/png" }, context());
    expect(result.status).toBe("EXTRACTION_FAILED");
  });

  it("replays a test fixture through the same validation/normalization every real response goes through", async () => {
    const extractor = createStubScreenshotVisionExtractor();
    const image = fixtureImage({
      accountHint: "Everyday Offset",
      transactions: [{ date: "2026-09-02", description: "Test fixture row", amount: "10.00", direction: "DEBIT", status: "POSTED", confidence: 0.95 }],
    });
    const result = await extractor(image, context());
    expect(result.status).toBe("OK");
    if (result.status !== "OK") throw new Error("unreachable");
    expect(result.transactions).toHaveLength(1);
  });
});
