import {
  createAnthropicCategorySuggestionExtractor,
  createStubCategorySuggestionExtractor,
  type CategorySuggestionBatchExtractor,
} from "@frodocodo/ai";

/**
 * Duplicates `apps/web/lib/categorySuggestionFactory.ts`'s exact
 * `AI_PROVIDER`/`ANTHROPIC_API_KEY` gate rather than importing it — this is
 * a plain Node process, not a Next.js app, so it has no `server-only`
 * boundary to share with apps/web's copy, and apps/web already depends on
 * `@frodocodo/worker` (not the other way around).
 */
export function getCategorySuggestionExtractor(): CategorySuggestionBatchExtractor {
  if (process.env.AI_PROVIDER === "anthropic" && process.env.ANTHROPIC_API_KEY) {
    return createAnthropicCategorySuggestionExtractor(process.env.ANTHROPIC_API_KEY, process.env.ANTHROPIC_MODEL);
  }
  return createStubCategorySuggestionExtractor();
}
