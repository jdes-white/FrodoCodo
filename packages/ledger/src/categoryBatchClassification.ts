import {
  classifyDeterministic,
  resolveClassification,
  DEFAULT_REVIEW_THRESHOLD,
  type MerchantRuleLookup,
  type LearnedMappingLookup,
  type DeterministicClassification,
  type ClassificationOutcome,
} from "./classification.js";

/**
 * Batched AI categorisation — pure planning/merging logic (production
 * screenshot-import diagnosis: Layer 4 of docs/financial-calculation-rules.md
 * §11 was fully specified in `classification.ts`'s types but never actually
 * produced anywhere — every ingestion call site passed `null` for it).
 *
 * Split out from the DB-touching orchestration
 * (`apps/worker/src/syncConnection.ts`'s `classifyTransactionBatch`, the one
 * function both real-provider sync and screenshot import call) so the actual
 * decision rules are unit-testable with plain objects, per this package's
 * own testing convention (no database, no network, no `@frodocodo/db`
 * import — see CLAUDE.md's architecture rules for why that boundary
 * matters).
 *
 * Two-step shape mirrors the batch's real lifecycle: `planCategorySuggestionBatch`
 * runs BEFORE any AI call exists to decide who even needs one;
 * `finalizeCategoryBatch` runs AFTER an AI answer (or lack of one) is known,
 * to fold it back in through the existing, unmodified `resolveClassification`
 * — reused, never bypassed, so priority (rule > learned mapping > AI) and
 * the review-queue fallback keep working exactly as they always have.
 */

export interface BatchClassifiableItem {
  /** Caller-defined correlation key — usually one per transaction candidate. */
  key: string;
  /** Merchant match key (`normalizeMerchant().matchKey`) — the unit AI suggestions are deduplicated by. */
  matchKey: string;
  /** Normalized merchant display name — never a raw provider description. */
  merchantName: string;
  /** Positive decimal string — a magnitude, never signed. */
  amount: string;
  direction: "DEBIT" | "CREDIT";
  merchantRule?: MerchantRuleLookup;
  learnedMapping?: LearnedMappingLookup;
}

export interface CategorySuggestionRequest {
  /** Equals the merchant's `matchKey` — one request per unique merchant among the batch's unresolved items. */
  key: string;
  merchantName: string;
  amount: string;
  direction: "DEBIT" | "CREDIT";
}

export interface CategorySuggestionAnswer {
  categoryId: string;
  confidence: number;
}

/** A row is auto-assigned from an AI answer only at or above this confidence — deliberately stricter than the deterministic layers' own 0.6 review threshold, since a model guess earns less trust by default than a household-confirmed rule or learned mapping. */
export const AI_CATEGORY_CONFIDENCE_THRESHOLD = 0.8;

/**
 * Step 1 (pre-AI): resolves Layers 1-2 (household rule, learned mapping)
 * for every item and returns the deduplicated set of unresolved merchants
 * that genuinely need an AI opinion.
 *
 * A merchant already classified confidently enough by a rule or learned
 * mapping (confidence >= `DEFAULT_REVIEW_THRESHOLD`) is never included in
 * `requests` — no AI call is made for it at all. A merchant repeated across
 * several unresolved items in the same batch (e.g. two Woolworths purchases
 * on one household's first import) produces exactly one request, keyed by
 * its `matchKey` — the caller reuses that single answer for every item
 * sharing the merchant (see `finalizeCategoryBatch`).
 */
export function planCategorySuggestionBatch(items: BatchClassifiableItem[]): {
  deterministicByKey: Map<string, DeterministicClassification | null>;
  requests: CategorySuggestionRequest[];
} {
  const deterministicByKey = new Map<string, DeterministicClassification | null>();
  const requestByMatchKey = new Map<string, CategorySuggestionRequest>();

  for (const item of items) {
    const deterministic = classifyDeterministic({
      merchantRule: item.merchantRule,
      learnedMapping: item.learnedMapping,
    });
    deterministicByKey.set(item.key, deterministic);

    const alreadyConfident = deterministic !== null && deterministic.confidence >= DEFAULT_REVIEW_THRESHOLD;
    if (!alreadyConfident && !requestByMatchKey.has(item.matchKey)) {
      requestByMatchKey.set(item.matchKey, {
        key: item.matchKey,
        merchantName: item.merchantName,
        amount: item.amount,
        direction: item.direction,
      });
    }
  }

  return { deterministicByKey, requests: [...requestByMatchKey.values()] };
}

/**
 * Step 2 (post-AI): combines each item's deterministic result with its
 * merchant's AI answer (if any) through the existing `resolveClassification`
 * — never bypassed. An AI answer only ever reaches `resolveClassification`
 * when it names a category id this household was actually offered (defense
 * in depth — `packages/ai`'s response parser already enforces this, but
 * this function doesn't trust that it always will have) AND clears
 * `aiConfidenceThreshold`; anything else — missing, unknown/invented
 * category, low confidence — is treated exactly like "no AI opinion",
 * which `resolveClassification` already knows how to fall back safely from
 * (NEEDS_REVIEW, `categoryId: null`).
 */
export function finalizeCategoryBatch(
  items: BatchClassifiableItem[],
  deterministicByKey: Map<string, DeterministicClassification | null>,
  aiAnswersByMatchKey: Map<string, CategorySuggestionAnswer | null>,
  allowedCategoryIds: ReadonlySet<string>,
  aiConfidenceThreshold: number = AI_CATEGORY_CONFIDENCE_THRESHOLD,
): Map<string, ClassificationOutcome> {
  const outcomes = new Map<string, ClassificationOutcome>();

  for (const item of items) {
    const deterministic = deterministicByKey.get(item.key) ?? null;
    const answer = aiAnswersByMatchKey.get(item.matchKey) ?? null;
    const validAiSuggestion =
      answer && answer.confidence >= aiConfidenceThreshold && allowedCategoryIds.has(answer.categoryId)
        ? { categoryId: answer.categoryId, confidence: answer.confidence }
        : null;

    outcomes.set(item.key, resolveClassification(deterministic, validAiSuggestion));
  }

  return outcomes;
}
