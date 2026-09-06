import "server-only";
import { FinancialIntelligenceService, StubGateway, AnthropicGateway, type ModelGateway } from "@frodocodo/ai";

/**
 * Single place that decides which model backs the household's AI features
 * (§21 — never instantiated client-side). Defaults to the deterministic
 * StubGateway (AI_PROVIDER unset or "stub"), so the app runs with zero LLM
 * credentials; set AI_PROVIDER=anthropic + ANTHROPIC_API_KEY to switch to
 * real Claude-generated narratives without changing any caller.
 */
let cached: FinancialIntelligenceService | null = null;

export function getFinancialIntelligenceService(): FinancialIntelligenceService {
  if (cached) return cached;

  let gateway: ModelGateway;
  if (process.env.AI_PROVIDER === "anthropic" && process.env.ANTHROPIC_API_KEY) {
    gateway = new AnthropicGateway(process.env.ANTHROPIC_API_KEY, process.env.ANTHROPIC_MODEL);
  } else {
    gateway = new StubGateway();
  }

  cached = new FinancialIntelligenceService(gateway);
  return cached;
}
