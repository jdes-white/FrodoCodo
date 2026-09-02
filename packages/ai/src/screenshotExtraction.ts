import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

/**
 * Batch screenshot transaction extraction — the vision half of the
 * screenshot-import feature. This is a deliberate, narrow exception to
 * "every AI feature goes through FinancialIntelligenceService" (CLAUDE.md
 * rule 2): that service exists to narrate figures the app already computed,
 * validated against a fact sheet of *known* numbers. There is no fact
 * sheet to validate a screenshot extraction against — reading the numbers
 * out of a photo the household just took *is* the task, the same way a
 * human typing them in manually would be. What CLAUDE.md rule 1 actually
 * protects (an LLM must never compute or restate a number it wasn't
 * handed) still holds here in spirit: nothing downstream trusts this
 * module's output as ledger-final. Every extracted row is re-validated
 * deterministically (date bounds, amount parsing, confidence threshold)
 * and then run through the exact same ingestion allow-list, dedupe, and
 * classification pipeline every other source uses — the model's only job
 * is producing candidates, never deciding what counts as spend.
 *
 * PRIVACY: nothing here persists an image or asks the model for anything
 * beyond a coarse source/account label and transaction rows. The system
 * prompt explicitly forbids reporting account numbers, BSBs, balances, or
 * card numbers (even masked ones) — see SYSTEM_PROMPT below.
 */

export const SCREENSHOT_SOURCES = ["CBA", "VIRGIN_MONEY", "AMEX", "UNKNOWN"] as const;
export type ScreenshotSource = (typeof SCREENSHOT_SOURCES)[number];

export interface ScreenshotImageInput {
  /** Base64-encoded image bytes. Never written to disk by this module — see apps/web/lib/screenshotImport.ts for the caller's in-memory-only lifecycle. */
  base64: string;
  /** e.g. "image/png", "image/jpeg". */
  mediaType: string;
}

export interface ExtractedTransactionCandidate {
  /** YYYY-MM-DD, fully resolved (including year) using the supplied `todayIso` and any visible date headers/relative labels. */
  date: string;
  /** As shown, wrapped lines joined into one string. Never an account number, BSB, or balance. */
  description: string;
  /** Positive decimal string — always a magnitude, never signed. */
  amount: string;
  direction: "DEBIT" | "CREDIT";
  status: "PENDING" | "POSTED";
  /** 0-1. Rows the model isn't confident about (cut off, obscured, ambiguous) should score low here rather than being guessed. */
  confidence: number;
}

export interface ScreenshotExtractionResult {
  source: ScreenshotSource;
  /** A coarse product/account title as shown (e.g. "Everyday Offset", "Velocity High Flyer Card") — never a number, even masked. Used only to help pick which FrodoCodo account this belongs to; never persisted verbatim. */
  accountHint: string | null;
  transactions: ExtractedTransactionCandidate[];
  /** Free-text notes from the model about what it excluded/couldn't read — surfaced for transparency, never persisted long-term. */
  notes?: string;
}

export type ScreenshotVisionExtractor = (
  image: ScreenshotImageInput,
  context: { todayIso: string },
) => Promise<ScreenshotExtractionResult>;

// ---------- Response validation ----------

const ExtractedRowSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  description: z.string().min(1).max(200),
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/),
  direction: z.enum(["DEBIT", "CREDIT"]),
  status: z.enum(["PENDING", "POSTED"]),
  confidence: z.number().min(0).max(1),
});

const ExtractionResponseSchema = z.object({
  source: z.enum(SCREENSHOT_SOURCES),
  accountHint: z.string().max(80).nullable().optional(),
  transactions: z.array(ExtractedRowSchema).max(200),
  notes: z.string().max(500).optional(),
});

const MIN_ROW_CONFIDENCE = 0.5;
/** A screenshot showing a transaction more than this many days in the future (clock skew/misread year) is treated as unreliable for that row. */
const MAX_FUTURE_DAYS = 2;
/** Screenshots of very old statements are unlikely and more likely a misread year — still allowed, just a generous bound. */
const MAX_PAST_DAYS = 731;

/**
 * Parses, validates, and deterministically normalizes a model's raw text
 * response into a `ScreenshotExtractionResult`. Shared by the real
 * Anthropic-backed extractor and the stub's fixture-replay path so both
 * are held to the exact same safety rules — a fixture used in tests can't
 * accidentally exercise a looser code path than production.
 *
 * Fails safe: any malformed/unparseable response, or one that fails
 * schema validation, becomes an UNKNOWN-source, zero-transaction result
 * rather than a thrown error the caller has to remember to catch per call
 * site.
 */
export function parseExtractionResponse(rawText: string, context: { todayIso: string }): ScreenshotExtractionResult {
  let parsed: unknown;
  try {
    const start = rawText.indexOf("{");
    const end = rawText.lastIndexOf("}");
    if (start === -1 || end === -1) throw new Error("no JSON object found");
    parsed = JSON.parse(rawText.slice(start, end + 1));
  } catch {
    return { source: "UNKNOWN", accountHint: null, transactions: [], notes: "Model response was not valid JSON." };
  }

  const result = ExtractionResponseSchema.safeParse(parsed);
  if (!result.success) {
    return { source: "UNKNOWN", accountHint: null, transactions: [], notes: "Model response did not match the expected schema." };
  }

  if (result.data.source === "UNKNOWN") {
    return { source: "UNKNOWN", accountHint: null, transactions: [], notes: result.data.notes };
  }

  const today = Date.parse(context.todayIso);
  const transactions = result.data.transactions
    .filter((row) => row.confidence >= MIN_ROW_CONFIDENCE)
    .filter((row) => {
      const rowMs = Date.parse(row.date);
      if (Number.isNaN(rowMs)) return false;
      const deltaDays = (rowMs - today) / 86_400_000;
      return deltaDays <= MAX_FUTURE_DAYS && deltaDays >= -MAX_PAST_DAYS;
    })
    .map((row) => normalizeDirectionForSource(row, result.data.source));

  return {
    source: result.data.source,
    accountHint: result.data.accountHint ?? null,
    transactions,
    notes: result.data.notes,
  };
}

/**
 * Amex's Velocity Platinum transaction list shows every amount unsigned —
 * a purchase and a payment/refund look the same visually except for
 * context (description) — per the task spec: "these amounts represent
 * credit-card expenditure and therefore must normalise to expense/outflow
 * despite no displayed minus sign." The model is told this explicitly in
 * the prompt and asked to reason about payment/refund-shaped descriptions;
 * this is the deterministic backstop, not the primary mechanism — CBA and
 * Virgin both display an explicit sign/style the model reads directly, so
 * they pass through unchanged.
 */
function normalizeDirectionForSource(row: z.infer<typeof ExtractedRowSchema>, source: ScreenshotSource): ExtractedTransactionCandidate {
  if (source !== "AMEX") return row;
  const looksLikePaymentOrCredit = /\b(PAYMENT RECEIVED|THANK YOU|REFUND|CREDIT ADJUSTMENT|CASHBACK)\b/i.test(row.description);
  return { ...row, direction: looksLikePaymentOrCredit ? row.direction : "DEBIT" };
}

// ---------- Prompt ----------

const SYSTEM_PROMPT = `You are reading a screenshot of a bank or credit card app's transaction list for a household budgeting tool. Extract ONLY what is visible.

Identify which app this is:
- "CBA": Commonwealth Bank / CommBank app — dark interface, transactions grouped under date headings like "Wed 02 Sep Today", a CBA category label under the description, amount on the right (negative or plain for spend, green/positive for income).
- "VIRGIN_MONEY": Virgin Money Australia app (Velocity High Flyer Card) — red header, white transaction list, full date headings like "Wednesday, 02 September 2026", "Pending" may appear under the amount.
- "AMEX": American Express Australia app (Velocity Platinum) — navy interface, short date headings like "30 Aug", amounts shown WITHOUT a minus sign even though they are almost always purchases (expenses). Only treat a row as a credit/payment if the description clearly says so (e.g. "payment received", "thank you", "refund").
- "UNKNOWN": anything else, or if you cannot confidently identify the app.

If UNKNOWN, return zero transactions.

For each COMPLETE, clearly legible transaction row (skip rows that are cut off at the very top/bottom of the image, obscured, or you are not confident about):
- Resolve the FULL date as YYYY-MM-DD, including the year. Today's date is {{TODAY}}. Use it to resolve relative labels ("Today", "Yesterday") and to infer the year for headings that omit it (assume the most recent past occurrence of that month/day relative to today, never a future date).
- Join any wrapped/multi-line description into one line.
- amount is always a positive decimal string (never include a minus sign).
- direction is "DEBIT" (money out) or "CREDIT" (money in) based on the sign/color/context shown.
- status is "PENDING" if labeled pending, otherwise "POSTED".
- confidence is 0-1 — use below 0.5 for anything you are guessing at, and simply omit rows you are not reasonably confident about rather than including them at a low score.

accountHint: a short product/card title exactly as shown (e.g. "Everyday Offset", "Velocity High Flyer Card"), or null if not visible. NEVER report an account number, BSB, or balance — not even a masked/partial one (e.g. never report something like "....1234").

Respond with ONLY a JSON object of this exact shape, no other text:
{"source": "CBA" | "VIRGIN_MONEY" | "AMEX" | "UNKNOWN", "accountHint": string | null, "transactions": [{"date": "YYYY-MM-DD", "description": string, "amount": string, "direction": "DEBIT" | "CREDIT", "status": "PENDING" | "POSTED", "confidence": number}], "notes": string}`;

function buildSystemPrompt(todayIso: string): string {
  return SYSTEM_PROMPT.replace("{{TODAY}}", todayIso);
}

// ---------- Real (Anthropic) extractor ----------

/** Minimal surface this module needs from the Anthropic SDK — lets tests inject a fake client instead of hitting a real API, the same DI pattern BasiqHttpClient uses for fetch. */
export interface AnthropicMessagesClient {
  messages: {
    create(params: unknown): Promise<{ content: Array<{ type: string; text?: string }> }>;
  };
}

export function createAnthropicScreenshotVisionExtractor(
  apiKey: string,
  model = "claude-sonnet-5",
  clientOverride?: AnthropicMessagesClient,
): ScreenshotVisionExtractor {
  if (!apiKey) throw new Error("createAnthropicScreenshotVisionExtractor requires an API key");
  const client: AnthropicMessagesClient = clientOverride ?? new Anthropic({ apiKey });

  return async (image, context) => {
    const message = await client.messages.create({
      model,
      max_tokens: 4096,
      system: buildSystemPrompt(context.todayIso),
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: image.mediaType, data: image.base64 } },
            { type: "text", text: "Extract the transactions from this screenshot." },
          ],
        },
      ],
    });

    const textBlock = message.content.find((block) => block.type === "text");
    if (!textBlock?.text) {
      return { source: "UNKNOWN", accountHint: null, transactions: [], notes: "Model returned no text content." };
    }
    return parseExtractionResponse(textBlock.text, context);
  };
}

// ---------- Stub extractor (no AI provider configured / dev+test fixture replay) ----------

/**
 * Used whenever no real vision provider is configured (AI_PROVIDER isn't
 * "anthropic", or ANTHROPIC_API_KEY is unset) — screenshot import must
 * fail safely, not crash, when that's the case (mirrors StubGateway's role
 * for the AI coach). Since there is no deterministic way to actually read
 * an arbitrary photo without a real vision model, a genuine image always
 * honestly reports UNKNOWN/zero transactions here — this stub never
 * pretends to have extracted something it didn't.
 *
 * The one exception is a fixture-replay path for tests: if the "image"
 * bytes begin with `TEST_FIXTURE_MARKER` followed by a JSON-encoded
 * `ScreenshotExtractionResult`, that fixture is replayed (still through
 * the exact same `parseExtractionResponse` validation/normalization every
 * real response goes through). This lets Playwright exercise the entire
 * upload -> extraction -> account resolution -> dedupe -> classification
 * -> sync pipeline deterministically, the same way MockProvider stands in
 * for BasiqProvider — never used for a real user-supplied screenshot.
 */
export const TEST_FIXTURE_MARKER = "FRODOCODO_SCREENSHOT_TEST_FIXTURE_V1:";

export function createStubScreenshotVisionExtractor(): ScreenshotVisionExtractor {
  return async (image, context) => {
    const decoded = Buffer.from(image.base64, "base64").toString("utf8");
    if (decoded.startsWith(TEST_FIXTURE_MARKER)) {
      const payload = decoded.slice(TEST_FIXTURE_MARKER.length);
      return parseExtractionResponse(payload, context);
    }
    return {
      source: "UNKNOWN",
      accountHint: null,
      transactions: [],
      notes: "No AI vision provider is configured (set AI_PROVIDER=anthropic and ANTHROPIC_API_KEY) — screenshots cannot be read.",
    };
  };
}
