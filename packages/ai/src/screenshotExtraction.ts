import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { TEST_FIXTURE_MARKER } from "./testFixtureMarker.js";

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
 * deterministically (date bounds, amount parsing) and then run through the
 * exact same ingestion allow-list, dedupe, and classification pipeline
 * every other source uses — the model's only job is producing candidates,
 * never deciding what counts as spend, and (as of the sanitisation
 * hardening pass) never even deciding which institution a screenshot is
 * from — that is now determined deterministically, pre-crop, by
 * `apps/web/lib/screenshotSanitizer.ts` and handed to this module as a known fact.
 *
 * PRIVACY: this module never sees a raw screenshot — its caller
 * (`apps/web/lib/screenshotImport.ts`) always sanitises first
 * (`apps/web/lib/screenshotSanitizer.ts`) and passes only the cropped, header/balance-
 * free image through. Nothing here persists an image or asks the model for
 * anything beyond a coarse account label and transaction rows. The system
 * prompt explicitly forbids reporting account numbers, BSBs, balances, or
 * card numbers (even masked ones) — see SYSTEM_PROMPT below.
 *
 * NO SILENT DROPPING: earlier versions of this module discarded any row
 * below a confidence threshold outright. That meant a plausible-but-
 * uncertain transaction could vanish from the batch with no trace. Now:
 * every row the model can structure at all — however unsure it is about
 * a detail — is kept and (deterministically, not by the model's own
 * say-so) marked `needsReview` below a confidence floor; only a row the
 * model genuinely cannot structure (or that fails validation — a bad
 * date/amount format, an implausible date) is excluded from `transactions`,
 * and even then it is counted, never silently absorbed into a "clean"
 * result — see `unparseableRowCount` below.
 *
 * `SCREENSHOT_SOURCES`/`ScreenshotSource` live here (not in the sanitizer
 * that actually determines one) deliberately: the sanitizer's own sharp
 * (native addon) dependency cannot live in this package. `packages/ai` is
 * transpiled by Next.js (`apps/web/next.config.ts`'s `transpilePackages`)
 * so its own workspace-local `node_modules/sharp` symlink gets swept into
 * the app's server bundle instead of staying external — even with `sharp`
 * declared in `serverExternalPackages` — because Next's bundling-opt-out
 * heuristic matches by the *symlink* path (which sits under this
 * package's own directory), not the real resolved location. A plain
 * `apps/web` source file doesn't have this problem (it isn't a transpiled
 * workspace dependency), so the sanitizer lives at
 * `apps/web/lib/screenshotSanitizer.ts` instead and imports this type from
 * here.
 */

export { TEST_FIXTURE_MARKER } from "./testFixtureMarker.js";

export const SCREENSHOT_SOURCES = ["CBA", "VIRGIN_MONEY", "AMEX"] as const;
export type ScreenshotSource = (typeof SCREENSHOT_SOURCES)[number];

export interface ScreenshotImageInput {
  /** Base64-encoded image bytes — always the *sanitised* crop, never the original upload. Never written to disk by this module. */
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
  /** 0-1. Reported honestly by the model — a low score no longer causes the row to be dropped, only flagged. */
  confidence: number;
  /** Deterministically derived (confidence < the auto-import threshold), never the model's own claim — a plausible row a human should glance at before it's trusted the way a confident one is. Never fabricated data; the row's fields are exactly what the model reported. */
  needsReview: boolean;
}

export type ScreenshotExtractionResult =
  | {
      status: "OK";
      transactions: ExtractedTransactionCandidate[];
      /** Total transaction-shaped rows the model reports it can see in the list, structured or not. */
      visibleRowCount: number;
      /** `visibleRowCount` minus the rows that made it into `transactions` — rows the model saw but could not confidently structure at all, or that failed deterministic validation (bad amount/date format, an implausible date). Zero for a clean extraction; nonzero means the caller must surface an explicit "N transaction(s) could not be reliably read" warning rather than reporting the batch as fully successful. */
      unparseableRowCount: number;
      /** A coarse product/account title as shown (e.g. "Everyday Offset", "Velocity High Flyer Card") — never a number, even masked. Used only to help pick which FrodoCodo account this belongs to; never persisted verbatim. */
      accountHint: string | null;
      /** Free-text notes from the model about what it excluded/couldn't read — surfaced for transparency, never persisted long-term. */
      notes?: string;
    }
  | {
      /** The model call itself failed, or its response couldn't be parsed/validated at all — distinct from "zero rows found", which is a legitimate OK result for a screenshot with no visible transactions. */
      status: "EXTRACTION_FAILED";
      reason: string;
    };

export type ScreenshotVisionExtractor = (
  image: ScreenshotImageInput,
  /** `knownSource` comes from `apps/web/lib/screenshotSanitizer.ts`'s deterministic layout detection, never from the model — the model is told which app this is rather than asked to guess. */
  context: { todayIso: string; knownSource: ScreenshotSource },
) => Promise<ScreenshotExtractionResult>;

/**
 * Shape of a `TEST_FIXTURE_MARKER` payload, for test authors building
 * fixtures (e.g. `apps/web/e2e/screenshot-import.spec.ts`) — not used
 * anywhere in the real extraction/validation path itself, which treats a
 * parsed payload as `unknown` and validates it against the same
 * `ExtractionResponseSchema`/`ExtractedRowSchema` a real model response
 * goes through. `source` here is read only by
 * `apps/web/lib/screenshotSanitizer.ts`'s matching fixture-replay path (to decide
 * `knownSource` before this module's `parseExtractionResponse` ever runs,
 * which itself ignores this extra key) — include `"UNKNOWN"` to exercise
 * the "unsupported/unsafe layout" fail-closed path in a test.
 * `needsReview`/`visibleRowCount`/`unparseableRowCount` are never supplied
 * here — they're always derived deterministically, never fixture input.
 */
export interface ScreenshotExtractionFixture {
  source: ScreenshotSource | "UNKNOWN";
  accountHint?: string | null;
  /** Omit to default to `transactions.length` (zero unparseable rows) — set higher to simulate rows the model saw but couldn't structure. */
  visibleRowCount?: number;
  transactions: Array<{
    date: string;
    description: string;
    amount: string;
    direction: "DEBIT" | "CREDIT";
    status: "PENDING" | "POSTED";
    confidence: number;
  }>;
  notes?: string;
}

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
  visibleRowCount: z.number().int().min(0).max(500).optional(),
  // Validated row-by-row below (not as z.array(ExtractedRowSchema)) so one
  // malformed row can't invalidate every other row's worth of otherwise-
  // good data in the same response — that would itself be a silent-drop
  // bug at the response level.
  transactions: z.array(z.unknown()).max(300),
  accountHint: z.string().max(80).nullable().optional(),
  notes: z.string().max(500).optional(),
});

/** A row's confidence below this becomes `needsReview: true` — it is still imported, never dropped. */
const NEEDS_REVIEW_CONFIDENCE_THRESHOLD = 0.7;
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
 * top-level schema validation, becomes an `EXTRACTION_FAILED` result
 * rather than a thrown error the caller has to remember to catch, or a
 * fabricated "zero transactions, all clear" result that would hide the
 * failure from the household.
 */
export function parseExtractionResponse(
  rawText: string,
  context: { todayIso: string; knownSource: ScreenshotSource },
): ScreenshotExtractionResult {
  let parsed: unknown;
  try {
    const start = rawText.indexOf("{");
    const end = rawText.lastIndexOf("}");
    if (start === -1 || end === -1) throw new Error("no JSON object found");
    parsed = JSON.parse(rawText.slice(start, end + 1));
  } catch {
    return { status: "EXTRACTION_FAILED", reason: "Model response was not valid JSON." };
  }

  const result = ExtractionResponseSchema.safeParse(parsed);
  if (!result.success) {
    return { status: "EXTRACTION_FAILED", reason: "Model response did not match the expected schema." };
  }

  const today = Date.parse(context.todayIso);
  const rawRows = result.data.transactions;
  const transactions: ExtractedTransactionCandidate[] = [];
  let rejectedRowCount = 0;

  for (const raw of rawRows) {
    const rowResult = ExtractedRowSchema.safeParse(raw);
    if (!rowResult.success) {
      rejectedRowCount++;
      continue;
    }
    const row = rowResult.data;
    const rowMs = Date.parse(row.date);
    const deltaDays = Number.isNaN(rowMs) ? NaN : (rowMs - today) / 86_400_000;
    if (Number.isNaN(deltaDays) || deltaDays > MAX_FUTURE_DAYS || deltaDays < -MAX_PAST_DAYS) {
      // An implausible/unparseable date is "genuinely unreadable", not
      // "plausible but uncertain" — never guessed into a fabricated date.
      rejectedRowCount++;
      continue;
    }
    const candidate: ExtractedTransactionCandidate = { ...row, needsReview: row.confidence < NEEDS_REVIEW_CONFIDENCE_THRESHOLD };
    transactions.push(normalizeDirectionForSource(candidate, context.knownSource));
  }

  // Rows the model reported seeing but never even attempted to structure —
  // distinct from rejectedRowCount above (rows it *did* attempt but that
  // failed validation). Both count toward the same "something may have
  // been missed" signal. Defaults to `rawRows.length` when the model
  // doesn't populate `visibleRowCount` at all, which makes the gap zero —
  // a conservative default that never invents a discrepancy the model
  // didn't report.
  const visibleRowCount = result.data.visibleRowCount ?? rawRows.length;
  const entirelyOmittedRowCount = Math.max(0, visibleRowCount - rawRows.length);
  const unparseableRowCount = rejectedRowCount + entirelyOmittedRowCount;

  return {
    status: "OK",
    transactions,
    visibleRowCount,
    unparseableRowCount,
    accountHint: result.data.accountHint ?? null,
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
function normalizeDirectionForSource(row: ExtractedTransactionCandidate, source: ScreenshotSource): ExtractedTransactionCandidate {
  if (source !== "AMEX") return row;
  const looksLikePaymentOrCredit = /\b(PAYMENT RECEIVED|THANK YOU|REFUND|CREDIT ADJUSTMENT|CASHBACK)\b/i.test(row.description);
  return { ...row, direction: looksLikePaymentOrCredit ? row.direction : "DEBIT" };
}

// ---------- Prompt ----------

const SOURCE_LABEL: Record<ScreenshotSource, string> = {
  CBA: "the Commonwealth Bank (CBA) app",
  VIRGIN_MONEY: "the Virgin Money Australia app",
  AMEX: "the American Express Australia app",
};

const SOURCE_NOTES: Record<ScreenshotSource, string> = {
  CBA: `Transactions are grouped under date headings like "Wed 02 Sep Today". A CBA category label may appear under the description — ignore it, don't include it in the description you report. Amount is on the right (negative or plain for spend, green/positive for income).`,
  VIRGIN_MONEY: `Full date headings look like "Wednesday, 02 September 2026". "Pending" may appear under the amount — if so, status is PENDING.`,
  AMEX: `Date headings are short, like "30 Aug". Amounts are shown WITHOUT a minus sign even though they are almost always purchases (expenses) — only treat a row as a credit/payment if the description clearly says so (e.g. "payment received", "thank you", "refund").`,
};

const SYSTEM_PROMPT = `You are reading a screenshot of a bank or credit card app's transaction list for a household budgeting tool. This image has already been cropped to remove the account header, balance, and navigation chrome — you are looking only at the transaction list itself, from {{SOURCE_LABEL}}.

{{SOURCE_NOTES}}

Report EVERY row you can see in the list, even ones you're not fully confident about — give an uncertain row a lower confidence score rather than leaving it out. Only leave a row out of "transactions" entirely if it is so cut off, obscured, or illegible that you cannot make out its date, description, and amount well enough to report them at all.

visibleRowCount: the total number of transaction rows you can see in the list, including any you're reporting with low confidence. This should almost always equal the number of items in "transactions" — only report it higher if there are rows you can visually tell exist (e.g. you can see a row divider, a fragment of an amount) but genuinely cannot structure into a row at all.

For each row you DO report:
- Resolve the FULL date as YYYY-MM-DD, including the year. Today's date is {{TODAY}}. Use it to resolve relative labels ("Today", "Yesterday") and to infer the year for headings that omit it (assume the most recent past occurrence of that month/day relative to today, never a future date).
- Join any wrapped/multi-line description into one line.
- amount is always a positive decimal string (never include a minus sign).
- direction is "DEBIT" (money out) or "CREDIT" (money in) based on the sign/color/context shown.
- status is "PENDING" if labeled pending, otherwise "POSTED".
- confidence is 0-1 — your honest confidence in this row. Do not invent a value you can't actually see; if a required field is genuinely illegible, leave the whole row out of "transactions" (it still counts toward visibleRowCount) rather than guessing at it.

accountHint: a short product/card title exactly as shown (e.g. "Everyday Offset", "Velocity High Flyer Card"), or null if not visible. NEVER report an account number, BSB, or balance — not even a masked/partial one (e.g. never report something like "....1234").

Respond with ONLY a JSON object of this exact shape, no other text:
{"visibleRowCount": number, "accountHint": string | null, "transactions": [{"date": "YYYY-MM-DD", "description": string, "amount": string, "direction": "DEBIT" | "CREDIT", "status": "PENDING" | "POSTED", "confidence": number}], "notes": string}`;

function buildSystemPrompt(todayIso: string, knownSource: ScreenshotSource): string {
  return SYSTEM_PROMPT.replace("{{TODAY}}", todayIso).replace("{{SOURCE_LABEL}}", SOURCE_LABEL[knownSource]).replace("{{SOURCE_NOTES}}", SOURCE_NOTES[knownSource]);
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
      system: buildSystemPrompt(context.todayIso, context.knownSource),
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
      return { status: "EXTRACTION_FAILED", reason: "Model returned no text content." };
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
 * honestly reports `EXTRACTION_FAILED` here — this stub never pretends to
 * have extracted something it didn't.
 *
 * The one exception is a fixture-replay path for tests: if the "image"
 * bytes begin with `TEST_FIXTURE_MARKER` followed by a JSON-encoded
 * fixture payload, that fixture is replayed (still through the exact same
 * `parseExtractionResponse` validation/normalization every real response
 * goes through). This lets Playwright exercise the entire upload ->
 * sanitize -> extraction -> account resolution -> dedupe -> classification
 * -> sync pipeline deterministically, the same way MockProvider stands in
 * for BasiqProvider — never used for a real user-supplied screenshot. A
 * fixture payload may still include a `source` field (read by
 * `apps/web/lib/screenshotSanitizer.ts`'s own matching test-replay path to decide
 * `knownSource` before this extractor ever runs) — it's simply an unused
 * extra key as far as `parseExtractionResponse`'s schema is concerned.
 */
export function createStubScreenshotVisionExtractor(): ScreenshotVisionExtractor {
  return async (image, context) => {
    const decoded = Buffer.from(image.base64, "base64").toString("utf8");
    if (decoded.startsWith(TEST_FIXTURE_MARKER)) {
      const payload = decoded.slice(TEST_FIXTURE_MARKER.length);
      return parseExtractionResponse(payload, context);
    }
    return {
      status: "EXTRACTION_FAILED",
      reason: "No AI vision provider is configured (set AI_PROVIDER=anthropic and ANTHROPIC_API_KEY) — screenshots cannot be read.",
    };
  };
}
