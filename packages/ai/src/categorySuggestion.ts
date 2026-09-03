import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { AnthropicMessagesClient } from "./screenshotExtraction.js";

/**
 * Batched AI transaction-categorisation suggestion — Layer 4 of
 * `docs/financial-calculation-rules.md` §11, the AI-suggestion producer
 * that previously didn't exist anywhere in the codebase (every call site
 * passed `null` for `resolveClassification`'s `aiSuggestion` argument; see
 * the production categorisation diagnosis this module closes).
 *
 * Mirrors `screenshotExtraction.ts`'s safety posture: `resolveClassification`
 * (`packages/ledger`) still makes every final call — this module's only job
 * is proposing a `{categoryId, confidence}` per unresolved merchant, chosen
 * from a closed list of category ids FrodoCodo itself supplies. It can
 * never invent a category, and a malformed/invalid/absent answer for any
 * item always degrades to "no suggestion" (`null`), never a thrown error
 * and never a guessed value — the caller already knows how to fall back
 * safely from a `null` suggestion (the household's existing deterministic
 * layers, or the review queue).
 *
 * PRIVACY: the only fields ever sent to the model are a normalized merchant
 * name, a transaction amount and direction, and the household's own
 * category id/name list — never a raw provider description, account
 * number, BSB, balance, card detail, or any household identity field. This
 * module never receives a screenshot or a provider payload; its input type
 * (`CategorySuggestionInput`) structurally cannot carry more than that.
 *
 * BATCHING: one call covers many transactions at once. The caller
 * (`apps/worker/src/syncConnection.ts`'s `classifyTransactionBatch`) is
 * responsible for deduplicating by merchant before calling this, so a
 * repeated merchant within one ingestion batch is never asked about twice.
 */

export interface AllowedCategoryOption {
  id: string;
  name: string;
}

export interface CategorySuggestionInput {
  /** Caller-defined correlation key, returned unchanged in the result map — the batch orchestrator uses one per unique merchant. */
  key: string;
  merchantName: string;
  /** Positive decimal string — a magnitude, never signed. */
  amount: string;
  direction: "DEBIT" | "CREDIT";
}

export interface CategorySuggestionOutcome {
  categoryId: string;
  /** 0-1, the model's own reported confidence. */
  confidence: number;
}

/** Always has one entry per input `key` — a key the model didn't confidently (or validly) answer for maps to `null`, never omitted. */
export type CategorySuggestionMap = Map<string, CategorySuggestionOutcome | null>;

export type CategorySuggestionBatchExtractor = (
  items: CategorySuggestionInput[],
  categories: AllowedCategoryOption[],
) => Promise<CategorySuggestionMap>;

function emptyResult(items: CategorySuggestionInput[]): CategorySuggestionMap {
  return new Map(items.map((i) => [i.key, null]));
}

// ---------- Response validation ----------

const SuggestionRowSchema = z.object({
  key: z.string(),
  categoryId: z.string().nullable(),
  confidence: z.number().min(0).max(1),
});

const SuggestionResponseSchema = z.object({
  suggestions: z.array(z.unknown()).max(300),
});

/**
 * Parses and strictly validates a model's raw text response. Shared by the
 * real Anthropic-backed extractor and its tests so both are held to the
 * exact same rules. Never throws: a malformed top-level shape degrades the
 * whole batch to "no suggestions"; an individual row with an unrecognized
 * key, an invented/unlisted category id, or a schema mismatch degrades only
 * that one entry — everything else in the same response is unaffected.
 */
export function parseCategorySuggestionResponse(
  rawText: string,
  items: CategorySuggestionInput[],
  categories: AllowedCategoryOption[],
): CategorySuggestionMap {
  const result = emptyResult(items);

  let parsed: unknown;
  try {
    const start = rawText.indexOf("{");
    const end = rawText.lastIndexOf("}");
    if (start === -1 || end === -1) throw new Error("no JSON object found");
    parsed = JSON.parse(rawText.slice(start, end + 1));
  } catch {
    return result;
  }

  const top = SuggestionResponseSchema.safeParse(parsed);
  if (!top.success) return result;

  const validKeys = new Set(items.map((i) => i.key));
  const validCategoryIds = new Set(categories.map((c) => c.id));

  for (const raw of top.data.suggestions) {
    const row = SuggestionRowSchema.safeParse(raw);
    if (!row.success) continue;
    if (!validKeys.has(row.data.key)) continue; // hallucinated/unrecognized key
    if (row.data.categoryId === null) continue; // model itself declined — stays null
    if (!validCategoryIds.has(row.data.categoryId)) continue; // invented/invalid category — never passed through
    result.set(row.data.key, { categoryId: row.data.categoryId, confidence: row.data.confidence });
  }

  return result;
}

// ---------- Prompt ----------

const SYSTEM_PROMPT = `You are categorising household transactions for a budgeting tool. You will be given a list of transactions and a fixed list of allowed categories.

ALLOWED CATEGORIES (choose ONLY from this list, by exact id — never invent a category id or name that isn't listed):
{{CATEGORIES}}

For each transaction, decide which single allowed category id best fits its merchant name, amount, and direction (DEBIT = money out, CREDIT = money in). If you are not genuinely confident, or nothing fits well, set "categoryId" to null rather than guessing — a low-confidence or null answer is completely fine and expected for an ambiguous or unfamiliar merchant.

confidence is 0-1: your honest confidence that the chosen category is correct for this transaction.

Respond with ONLY a JSON object of this exact shape, no other text:
{"suggestions": [{"key": string, "categoryId": string | null, "confidence": number}]}
One entry per transaction "key" given below, in any order.`;

function buildSystemPrompt(categories: AllowedCategoryOption[]): string {
  const list = categories.map((c) => `- id: "${c.id}", name: "${c.name}"`).join("\n");
  return SYSTEM_PROMPT.replace("{{CATEGORIES}}", list);
}

// ---------- Real (Anthropic) extractor ----------

export function createAnthropicCategorySuggestionExtractor(
  apiKey: string,
  model = "claude-sonnet-5",
  clientOverride?: AnthropicMessagesClient,
): CategorySuggestionBatchExtractor {
  if (!apiKey) throw new Error("createAnthropicCategorySuggestionExtractor requires an API key");
  const client: AnthropicMessagesClient = clientOverride ?? new Anthropic({ apiKey });

  return async (items, categories) => {
    if (items.length === 0 || categories.length === 0) return emptyResult(items);

    // Deliberately minimal — only merchant name, amount and direction ever
    // leave this process for categorisation. No description, account,
    // provider, or household-identity field exists on `CategorySuggestionInput`
    // to accidentally include here.
    const userPayload = {
      transactions: items.map((i) => ({ key: i.key, merchantName: i.merchantName, amount: i.amount, direction: i.direction })),
    };

    try {
      const message = await client.messages.create({
        model,
        max_tokens: 2048,
        system: buildSystemPrompt(categories),
        messages: [{ role: "user", content: JSON.stringify(userPayload) }],
      });
      const textBlock = message.content.find((block) => block.type === "text");
      if (!textBlock?.text) return emptyResult(items);
      return parseCategorySuggestionResponse(textBlock.text, items, categories);
    } catch {
      // Anthropic failure (network, rate limit, auth, malformed SDK error,
      // etc.) must never block ingestion — every item just stays
      // unresolved, exactly as if no AI provider were configured at all.
      return emptyResult(items);
    }
  };
}

// ---------- Stub extractor (no AI provider configured) ----------

/** Mirrors `createStubScreenshotVisionExtractor` — honestly reports no suggestions rather than fabricating a category. */
export function createStubCategorySuggestionExtractor(): CategorySuggestionBatchExtractor {
  return async (items) => emptyResult(items);
}
