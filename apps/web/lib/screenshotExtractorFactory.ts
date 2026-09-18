import "server-only";
import { createAnthropicScreenshotVisionExtractor, createStubScreenshotVisionExtractor, type ScreenshotVisionExtractor } from "@frodocodo/ai";

/**
 * Mirrors apps/web/lib/aiGateway.ts's exact pattern for the AI coach:
 * AI_PROVIDER=anthropic + ANTHROPIC_API_KEY gets the real vision-backed
 * extractor; anything else gets the stub, which honestly reports
 * UNKNOWN/zero-transactions for a real photo (there is no deterministic
 * way to read an arbitrary image without a real vision model) rather than
 * silently pretending to work. Unlike the AI coach, there is no
 * "degrade to a deterministic template" option here — screenshot import
 * simply isn't available without a configured vision provider, and reports
 * that plainly in the import summary instead of crashing.
 */
export function getScreenshotVisionExtractor(): ScreenshotVisionExtractor {
  if (process.env.AI_PROVIDER === "anthropic" && process.env.ANTHROPIC_API_KEY) {
    return createAnthropicScreenshotVisionExtractor(process.env.ANTHROPIC_API_KEY, process.env.ANTHROPIC_MODEL);
  }
  return createStubScreenshotVisionExtractor();
}
