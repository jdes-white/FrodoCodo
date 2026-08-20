import type { PacingResult } from "./pacing.js";

/**
 * Answers a different question than budget position (how much money is
 * left — see PacingResult.remaining/.percentConsumed): is CURRENT spending
 * sustainable given how far through the period we are? A household can
 * have plenty of money left and still be spending too fast for how early
 * it is in the period — variance (spentToDate vs. the pace-aware
 * expectedSpendToDate PacingResult already computes) is what should flag
 * that, not "remaining >= 0".
 *
 * Deliberately 4 tiers with unambiguous English, replacing the old
 * AHEAD/BEHIND wording (still used internally as PacingResult.pacingStatus
 * for backward compatibility, e.g. the AI fact sheet) whose plain-English
 * reading doesn't say which direction is good. Green (COMFORTABLY_ON_TRACK,
 * ON_TRACK) always means financially favourable; WATCH_SPENDING/OFF_TRACK
 * always mean attention is needed.
 */
export type SpendPaceStatus = "COMFORTABLY_ON_TRACK" | "ON_TRACK" | "WATCH_SPENDING" | "OFF_TRACK";

/** Matches calculatePacing's own default varianceThresholdRatio (§ ON_TRACK band). */
const ON_TRACK_THRESHOLD_RATIO = 0.05;
/** Beyond 3x the on-track threshold, spending is significantly off pace, not just worth a glance. */
const OFF_TRACK_THRESHOLD_RATIO = ON_TRACK_THRESHOLD_RATIO * 3;

export function deriveSpendPaceStatus(pacing: Pick<PacingResult, "variance" | "allocation">): SpendPaceStatus {
  if (pacing.allocation.isZero()) return "ON_TRACK";
  const ratio = pacing.variance.dividedBy(pacing.allocation.abs()).toNumber();
  if (ratio <= -ON_TRACK_THRESHOLD_RATIO) return "COMFORTABLY_ON_TRACK";
  if (ratio <= ON_TRACK_THRESHOLD_RATIO) return "ON_TRACK";
  if (ratio <= OFF_TRACK_THRESHOLD_RATIO) return "WATCH_SPENDING";
  return "OFF_TRACK";
}

export function spendPaceLabel(status: SpendPaceStatus): string {
  switch (status) {
    case "COMFORTABLY_ON_TRACK":
      return "Comfortably on track";
    case "ON_TRACK":
      return "On track";
    case "WATCH_SPENDING":
      return "Watch spending";
    case "OFF_TRACK":
      return "Off track";
  }
}

export interface SpendPaceExplanation {
  status: SpendPaceStatus;
  /** Short, always-safe-to-render one-liner — the status must never be an unexplained score. */
  summary: string;
}

/**
 * Deterministic, from facts already on PacingResult — never an LLM call.
 * `budgetLabel` lets a caller say "flexible budget" when the pacing being
 * explained excludes fixed commitments (see apps/web/lib/budgetSnapshot.ts's
 * flexibleBudget) versus plain "budget" for an unfiltered total.
 */
export function explainSpendPace(
  pacing: Pick<PacingResult, "variance" | "allocation" | "percentPeriodElapsed" | "percentConsumed">,
  budgetLabel = "budget",
): SpendPaceExplanation {
  const status = deriveSpendPaceStatus(pacing);
  const elapsed = Math.round(pacing.percentPeriodElapsed);
  const used = Math.round(pacing.percentConsumed);
  return {
    status,
    summary: `${elapsed}% through the period · ${used}% of ${budgetLabel} used`,
  };
}
