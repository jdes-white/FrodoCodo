import { z } from "zod";
import type { FinancialFactSheet } from "./factSheet.js";

export const NarrativeResponseSchema = z.object({
  narrative: z.string().min(1).max(2000),
});
export type NarrativeResponse = z.infer<typeof NarrativeResponseSchema>;

export type IntelligenceRequestType = "EXPLAIN_INSIGHT" | "ANSWER_QUESTION" | "COACH_SUMMARY";

export interface IntelligenceRequest {
  type: IntelligenceRequestType;
  factSheet: FinancialFactSheet;
  /** The household's own words, for ANSWER_QUESTION (conversational AI, §24). */
  question?: string;
  /** For EXPLAIN_INSIGHT — which deterministic insight is being explained. */
  insightTitle?: string;
}

/**
 * The only way anything in this codebase talks to an LLM (§21). Swappable —
 * a new provider is a new class implementing this interface, not a rewrite
 * of the callers.
 */
export interface ModelGateway {
  readonly id: string;
  generateNarrative(request: IntelligenceRequest): Promise<unknown>;
}
