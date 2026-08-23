/**
 * Home Page 1's circular tracker: "where should I be, versus where am I?"
 * Deliberately distinct from spendPace.ts's SpendPaceStatus (dollar-variance
 * ratio against the *total* recurring-aware budget, 4 tiers, used by
 * Insights/elsewhere) — this is a percentage-point comparison between two
 * *percentages* (actual spend % of the flexible budget vs. expected
 * position % at this point in the period), 5 tiers, used only to drive the
 * dual-arc ring's colour and status pill. Both stay in place; this module
 * doesn't replace spendPace.ts.
 */

export type PaceStatus = "COMFORTABLY_AHEAD" | "AHEAD_OF_PLAN" | "ON_TRACK" | "SLIGHTLY_OVER_PACE" | "OVER_PACE";

/** Percentage-point thresholds, in ascending order — the single source of
 * truth for both the discrete tier classification and the continuous
 * gradient's anchor points, so the two can never drift apart. */
const DARK_GREEN_THRESHOLD = -10;
const LIGHT_GREEN_THRESHOLD = -3;
const ORANGE_THRESHOLD = 3;
const RED_THRESHOLD = 10;

/** actual spend % minus expected position %. Negative = spending less than expected (good); positive = spending more (bad). */
export function derivePaceDifference(actualPercent: number, expectedPercent: number): number {
  return actualPercent - expectedPercent;
}

/**
 * Five-tier classification of the pace difference (V1 ranges from the
 * brief). Contiguous, gapless partition of the real line using the same
 * four threshold values the brief calls out — no percentage-point value
 * falls outside all five bands.
 */
export function derivePaceStatus(difference: number): PaceStatus {
  if (difference <= DARK_GREEN_THRESHOLD) return "COMFORTABLY_AHEAD";
  if (difference <= LIGHT_GREEN_THRESHOLD) return "AHEAD_OF_PLAN";
  if (difference < ORANGE_THRESHOLD) return "ON_TRACK";
  if (difference < RED_THRESHOLD) return "SLIGHTLY_OVER_PACE";
  return "OVER_PACE";
}

export function paceStatusLabel(status: PaceStatus): string {
  switch (status) {
    case "COMFORTABLY_AHEAD":
      return "Comfortably on track";
    case "AHEAD_OF_PLAN":
      return "Ahead of plan";
    case "ON_TRACK":
      return "On track";
    case "SLIGHTLY_OVER_PACE":
      return "Slightly over pace";
    case "OVER_PACE":
      return "Over pace";
  }
}

/**
 * A continuous 0..1 position across the dark-green -> red gradient (a
 * "financial temperature gauge", not five disconnected traffic-light
 * states — see the brief). 0 = fully saturated dark green (10pp+ ahead),
 * 1 = fully saturated red (10pp+ over pace), 0.5 = pure yellow (exactly on
 * pace). Clamped at both ends so being extremely ahead or behind doesn't
 * keep intensifying indefinitely — matches "use the strongest/darkest
 * green" reading like a plateau, not an unbounded scale.
 *
 * The three interior thresholds (-3, 0 implied, +3) land at t = 0.35,
 * 0.5, 0.65 under this simple linear map over [-10, 10] — those are
 * exactly the anchor points the UI layer's colour gradient uses, so the
 * discrete tier boundaries and the continuous gradient can never disagree
 * about where "light green" or "orange" actually sits.
 */
export function derivePaceGradientPosition(difference: number): number {
  const clamped = Math.min(Math.max(difference, DARK_GREEN_THRESHOLD), RED_THRESHOLD);
  return (clamped - DARK_GREEN_THRESHOLD) / (RED_THRESHOLD - DARK_GREEN_THRESHOLD);
}

/**
 * Clamps a percent to [0, 100] for rendering a bounded SVG arc fill — an
 * overspend (actual > 100% of the flexible budget) must not wrap the arc
 * around for a misleading second lap. Deliberately only used for the
 * *visual* fill: status/color derivation elsewhere always uses the raw,
 * unclamped actual percent, so a genuine overspend still reads as
 * strongly OVER_PACE rather than being softened by this clamp.
 */
export function clampArcPercent(percent: number): number {
  return Math.min(Math.max(percent, 0), 100);
}
