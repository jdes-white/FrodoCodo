import "server-only";
import {
  createAnthropicCategorySuggestionExtractor,
  createStubCategorySuggestionExtractor,
  type CategorySuggestionBatchExtractor,
} from "@frodocodo/ai";

/**
 * Mirrors `apps/web/lib/screenshotExtractorFactory.ts`'s exact
 * `AI_PROVIDER`/`ANTHROPIC_API_KEY` gate, for the batched
 * categorisation-suggestion extractor (production categorisation
 * diagnosis's Layer 4 fix). AI_PROVIDER=stub or an unreachable Anthropic
 * API never blocks screenshot import — the stub simply reports no
 * suggestions, and every transaction falls back to the household's
 * existing deterministic layers / the review queue, exactly as it did
 * before this extractor existed (CLAUDE.md rule 8).
 */
export function getCategorySuggestionExtractor(): CategorySuggestionBatchExtractor {
  if (process.env.AI_PROVIDER === "anthropic" && process.env.ANTHROPIC_API_KEY) {
    return createAnthropicCategorySuggestionExtractor(process.env.ANTHROPIC_API_KEY, process.env.ANTHROPIC_MODEL);
  }
  return createStubCategorySuggestionExtractor();
}
