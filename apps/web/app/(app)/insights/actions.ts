"use server";

import { requireSession } from "@/lib/session";
import { getBudgetSnapshot } from "@/lib/budgetSnapshot";
import { buildFactSheet } from "@/lib/factSheetBuilder";
import { getFinancialIntelligenceService } from "@/lib/aiGateway";

export interface AskState {
  question?: string;
  answer?: string;
  source?: string;
}

/**
 * §24 conversational AI. The household's question plus a deterministic fact
 * sheet (never the raw ledger) go to FinancialIntelligenceService, which
 * validates the response and transparently falls back to a template if the
 * model is unavailable or invents a number (§44, §45) — the user sees an
 * answer either way, just not which path produced it beyond the small
 * "source" label.
 */
export async function askCoach(_prevState: AskState, formData: FormData): Promise<AskState> {
  const session = await requireSession();
  const question = String(formData.get("question") ?? "").trim();
  if (!question) return { error: "Ask a question first." } as AskState;

  const snapshot = await getBudgetSnapshot(session.householdId);
  const factSheet = buildFactSheet(snapshot);
  const service = getFinancialIntelligenceService();

  const result = await service.respond({ type: "ANSWER_QUESTION", factSheet, question });

  return { question, answer: result.narrative, source: result.source };
}
