import { paceStatusLabel, type PaceStatus } from "@frodocodo/domain";
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

/**
 * Ascending "how concerning is this" order for `PaceStatus` — used only to
 * pick which non-ON_TRACK buckets are worth calling out by name, most
 * concerning first. Not a second classification: the wording itself
 * always comes straight from `paceStatusLabel` below, never a
 * hand-written per-branch phrase. A hand-written BEHIND/AHEAD branch here
 * is exactly what previously described an overspending bucket as
 * "running ahead of its expected pace" (the confirmed inversion bug this
 * rewrite fixes) — reusing the same label the status pill shows makes
 * that class of bug structurally impossible, not just corrected once.
 */
const PACE_STATUS_SEVERITY: PaceStatus[] = ["COMFORTABLY_AHEAD", "AHEAD_OF_PLAN", "ON_TRACK", "SLIGHTLY_OVER_PACE", "OVER_PACE"];

function buildTemplateNarrative(request: IntelligenceRequest): string {
  const { factSheet } = request;
  const { totals } = factSheet;

  const lines: string[] = [
    `At your current rate, the household has ${totals.remaining} remaining out of ${totals.allocation} for this period, and spending is ${paceStatusLabel(totals.status).toLowerCase()}.`,
  ];

  const notable = [...factSheet.buckets]
    .filter((b) => b.status !== "ON_TRACK")
    .sort((a, b) => PACE_STATUS_SEVERITY.indexOf(b.status) - PACE_STATUS_SEVERITY.indexOf(a.status))
    .slice(0, 2);
  for (const bucket of notable) {
    lines.push(`${bucket.name} is ${paceStatusLabel(bucket.status).toLowerCase()}, with ${bucket.remaining} remaining.`);
  }

  if (totals.projectedEndOfPeriod) {
    lines.push(`If current spending continues, the data shows a projected period-end position of ${totals.projectedEndOfPeriod}.`);
  }

  return lines.join(" ");
}
