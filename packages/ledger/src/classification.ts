import type { ClassificationSource } from "@frodocodo/shared";

/**
 * The layered categorisation engine (§11). Deterministic layers (rule,
 * learned mapping, provider enrichment) are resolved here, synchronously,
 * in strict precedence order. The AI layer runs elsewhere (packages/ai —
 * it's inherently async/external) and its suggestion is passed in as
 * `aiSuggestion`; this module makes the final call on whether ANY signal
 * is confident enough to auto-classify, or whether the transaction belongs
 * in the review queue (Layer 5, §20). Manual approval of already-confident
 * classifications is intentionally not part of this flow (§20).
 */

export const DEFAULT_REVIEW_THRESHOLD = 0.6;

export interface MerchantRuleLookup {
  categoryId: string;
  ruleId: string;
}

export interface LearnedMappingLookup {
  categoryId: string;
  confidence: number;
}

export interface ProviderCategoryLookup {
  categoryId: string;
  confidence: number;
}

export interface AiSuggestion {
  categoryId: string;
  confidence: number;
}

export interface ClassificationInput {
  merchantRule?: MerchantRuleLookup | null;
  learnedMapping?: LearnedMappingLookup | null;
  providerCategory?: ProviderCategoryLookup | null;
}

export interface DeterministicClassification {
  categoryId: string;
  source: Extract<ClassificationSource, "RULE" | "LEARNED_MAPPING" | "PROVIDER">;
  confidence: number;
  ruleId?: string;
}

/** Layers 1-3: household rule > learned mapping > provider enrichment. First hit wins. */
export function classifyDeterministic(input: ClassificationInput): DeterministicClassification | null {
  if (input.merchantRule) {
    return { categoryId: input.merchantRule.categoryId, source: "RULE", confidence: 1, ruleId: input.merchantRule.ruleId };
  }
  if (input.learnedMapping) {
    return { categoryId: input.learnedMapping.categoryId, source: "LEARNED_MAPPING", confidence: input.learnedMapping.confidence };
  }
  if (input.providerCategory) {
    return { categoryId: input.providerCategory.categoryId, source: "PROVIDER", confidence: input.providerCategory.confidence };
  }
  return null;
}

export type ClassificationOutcome =
  | { status: "CLASSIFIED"; categoryId: string; source: ClassificationSource; confidence: number; ruleId?: string }
  | {
      status: "NEEDS_REVIEW";
      bestGuessCategoryId?: string;
      bestGuessSource?: ClassificationSource;
      bestGuessConfidence?: number;
    };

/** Layer 4 (AI) + Layer 5 (review queue fallback). */
export function resolveClassification(
  deterministic: DeterministicClassification | null,
  aiSuggestion: AiSuggestion | null,
  threshold: number = DEFAULT_REVIEW_THRESHOLD,
): ClassificationOutcome {
  if (deterministic && deterministic.confidence >= threshold) {
    return {
      status: "CLASSIFIED",
      categoryId: deterministic.categoryId,
      source: deterministic.source,
      confidence: deterministic.confidence,
      ruleId: deterministic.ruleId,
    };
  }
  if (aiSuggestion && aiSuggestion.confidence >= threshold) {
    return { status: "CLASSIFIED", categoryId: aiSuggestion.categoryId, source: "AI", confidence: aiSuggestion.confidence };
  }

  const candidates: Array<{ categoryId: string; source: ClassificationSource; confidence: number }> = [];
  if (deterministic) candidates.push(deterministic);
  if (aiSuggestion) candidates.push({ categoryId: aiSuggestion.categoryId, source: "AI", confidence: aiSuggestion.confidence });
  candidates.sort((a, b) => b.confidence - a.confidence);
  const best = candidates[0];

  return {
    status: "NEEDS_REVIEW",
    bestGuessCategoryId: best?.categoryId,
    bestGuessSource: best?.source,
    bestGuessConfidence: best?.confidence,
  };
}

/**
 * §11 Layer 2 / §12: once a household has corrected the same merchant to the
 * same category enough times without an explicit rule, treat that as a
 * learned mapping so future transactions from that merchant stop needing
 * attention. Pure aggregation — the caller supplies the household's recent
 * USER-sourced classifications for one merchant.
 */
export function deriveLearnedMapping(
  recentUserClassifications: Array<{ categoryId: string }>,
  minRepeats = 3,
): LearnedMappingLookup | null {
  if (recentUserClassifications.length < minRepeats) return null;

  const counts = new Map<string, number>();
  for (const c of recentUserClassifications) {
    counts.set(c.categoryId, (counts.get(c.categoryId) ?? 0) + 1);
  }
  const [topCategoryId, topCount] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]!;
  if (topCount < minRepeats) return null;

  return { categoryId: topCategoryId, confidence: Math.min(0.95, 0.6 + topCount * 0.05) };
}
