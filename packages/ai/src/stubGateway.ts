import type { IntelligenceRequest, ModelGateway } from "./modelGateway.js";

/**
 * Deterministic, template-based gateway used whenever AI_PROVIDER=stub
 * (the default — see .env.example). The app is fully usable with zero LLM
 * credentials: this produces the same shape of response a real model
 * would, using only the fact sheet, so AI is never a dependency for core
 * operation (§44). Swap in AnthropicGateway to get genuinely generated
 * language; the FinancialIntelligenceService and its validation are
 * identical either way.
 */
export class StubGateway implements ModelGateway {
  readonly id = "stub";

  async generateNarrative(request: IntelligenceRequest): Promise<unknown> {
    return { narrative: buildTemplateNarrative(request) };
  }
}

function buildTemplateNarrative(request: IntelligenceRequest): string {
  const { factSheet } = request;
  const { totals } = factSheet;

  const statusPhrase =
    totals.status === "AHEAD"
      ? "ahead of budget pace"
      : totals.status === "BEHIND"
        ? "behind budget pace"
        : "on track";

  const lines: string[] = [
    `At your current rate, the household has ${totals.remaining} remaining out of ${totals.allocation} for this period, and spending is ${statusPhrase}.`,
  ];

  const notable = [...factSheet.buckets].sort((a, b) => (a.status === "BEHIND" ? -1 : 1)).slice(0, 2);
  for (const bucket of notable) {
    if (bucket.status === "BEHIND") {
      lines.push(`${bucket.name} is running ahead of its expected pace, with ${bucket.remaining} remaining.`);
    } else if (bucket.status === "AHEAD") {
      lines.push(`${bucket.name} is comfortably under pace, with ${bucket.remaining} remaining.`);
    }
  }

  if (totals.projectedEndOfPeriod) {
    lines.push(`If current spending continues, the data shows a projected period-end position of ${totals.projectedEndOfPeriod}.`);
  }

  if (request.type === "ANSWER_QUESTION" && request.question) {
    lines.unshift(`Regarding "${request.question}":`);
  }

  return lines.join(" ");
}
