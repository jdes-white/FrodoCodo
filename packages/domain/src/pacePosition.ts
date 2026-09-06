import { percentage } from "@frodocodo/shared";
import type { PacingResult } from "./pacing.js";

/** The minimal slice of a `PacingResult` `derivePaceStatusFromPacing` needs — a single category's, a bucket's, or the household total's. */
export type PacePosableInput = Pick<PacingResult, "percentConsumed" | "allocation" | "expectedSpendToDate">;

/**
 * The canonical, single source of truth for how the household's spending
 * *pace* is classified and worded anywhere in the product — Home's Panel 1
 * ring, every bucket/category status pill (Home Panel 2's BucketCard,
 * `/plan/buckets/[bucketId]`), the Insights headline, and the AI
 * fact sheet/narrative (packages/ai) all route through
 * `derivePaceStatus`/`derivePaceStatusFromPacing` and `paceStatusLabel`
 * below. Before this became canonical, three independently-threshold'd
 * status systems coexisted (this one, spendPace.ts's now-removed
 * SpendPaceStatus, and PacingResult.pacingStatus's internal 3-tier
 * AHEAD/ON_TRACK/BEHIND) and could — and did — describe the exact same
 * financial position differently on different screens. Don't reintroduce
 * a second one; if a surface needs a *different number* to classify
 * (e.g. Home Panel 1 intentionally scopes to the flexible-only budget
 * while Insights/bucket cards use the bucket's or household's full
 * pacing — see the doc comment on `derivePaceStatusFromPacing`), that's a
 * legitimate choice of *input*, but it must still go through this same
 * classification function.
 *
 * The metric is a percentage-point comparison between two *percentages*
 * (actual spend % of the relevant allocation vs. expected position % at
 * this point in the period) — not a dollar-variance ratio — because a
 * percentage-point difference reads the same regardless of how large or
 * small the underlying allocation is, which is what makes it safe to
 * reuse identically for a single category, a whole bucket, or the entire
 * household.
 *
 * ## Threshold policy (deliberate, not incidental)
 *
 * Five tiers, four threshold values, in percentage points of difference
 * (actual% − expected%):
 *
 * | Difference        | Status              | Colour            |
 * |-------------------|----------------------|-------------------|
 * | ≤ −10pp           | COMFORTABLY_AHEAD    | dark green        |
 * | (−10pp, −3pp]     | AHEAD_OF_PLAN        | light green       |
 * | (−3pp, +3pp)      | ON_TRACK             | amber/yellow      |
 * | [+3pp, +10pp)     | SLIGHTLY_OVER_PACE   | orange            |
 * | ≥ +10pp           | OVER_PACE            | red               |
 *
 * Boundary values are handled with a *deliberately asymmetric, cautious*
 * rule, chosen once and preserved rather than "fixed" into false
 * symmetry: a value sitting exactly on a boundary between a favourable
 * and unfavourable tier always resolves to the more cautious side.
 * Concretely, −10pp and −3pp round *up* into the better neighbouring tier
 * (COMFORTABLY_AHEAD, AHEAD_OF_PLAN) — being unambiguously ahead is
 * rewarded rather than second-guessed — while +3pp and +10pp round *up*
 * into the worse neighbouring tier (SLIGHTLY_OVER_PACE, OVER_PACE) —
 * a household exactly at the line where spending starts to look
 * concerning is warned early rather than reassured. Either way, a tie
 * never resolves toward complacency. This means the true ON_TRACK band
 * is the open interval (−3pp, +3pp): landing exactly on either edge always
 * exits ON_TRACK toward the cautious side. See pacePosition.test.ts's
 * "is a contiguous, gapless partition at every named threshold" test for
 * the exact boundary behaviour this locks in.
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
 * Five-tier classification of the pace difference — see this module's
 * doc comment above for the full threshold table and why the boundary
 * rounding is intentionally asymmetric (cautious on both sides, never
 * complacent). Contiguous, gapless partition of the real line: no
 * percentage-point value falls outside all five bands.
 */
export function derivePaceStatus(difference: number): PaceStatus {
  if (difference <= DARK_GREEN_THRESHOLD) return "COMFORTABLY_AHEAD";
  if (difference <= LIGHT_GREEN_THRESHOLD) return "AHEAD_OF_PLAN";
  if (difference < ORANGE_THRESHOLD) return "ON_TRACK";
  if (difference < RED_THRESHOLD) return "SLIGHTLY_OVER_PACE";
  return "OVER_PACE";
}

/**
 * The canonical adapter from a `PacingResult` (or any subset of one — a
 * single category's, a bucket's, or the household total's) to `PaceStatus`
 * — every UI/AI surface that has a PacingResult in hand should call this
 * rather than re-deriving `actualPercent`/`expectedPercent` by hand.
 *
 * Deliberately takes whatever `percentConsumed`/`allocation`/
 * `expectedSpendToDate` the caller already has rather than forcing one
 * fixed scope (e.g. "always the flexible-only budget") — Home Panel 1
 * intentionally classifies pace against the flexible-only budget (a fixed
 * commitment posting on schedule isn't a pacing signal), while bucket/
 * category cards and the Insights/AI totals intentionally classify
 * against their own full pacing (including fixed commitments, via the
 * recurring-aware `expectedSpendToDate` budgetSnapshot.ts already
 * computes). That's a legitimate choice of *input scope*, not a second
 * classification system — every one of those call sites still ends up
 * here, so the same input always yields the same status and label
 * everywhere, and Home/Insights/AI can never describe one true position
 * two different ways.
 *
 * `percentage()`'s own zero-denominator guard (returns 0) means a $0
 * allocation with real spend classifies as ON_TRACK (both actual% and
 * expected% collapse to 0) rather than crashing — an existing, understood
 * edge case, not something this task changes.
 */
export function derivePaceStatusFromPacing(pacing: PacePosableInput): PaceStatus {
  const expectedPercent = percentage(pacing.expectedSpendToDate, pacing.allocation);
  return derivePaceStatus(derivePaceDifference(pacing.percentConsumed, expectedPercent));
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

export interface PaceExplanation {
  status: PaceStatus;
  /** Short, always-safe-to-render one-liner — the status must never be an unexplained score. */
  summary: string;
}

/**
 * Deterministic, from facts already on a PacingResult — never an LLM call.
 * Replaces the old per-surface "explainSpendPace" (spendPace.ts, removed)
 * now that this module is the one place status gets derived; `budgetLabel`
 * still lets a caller say "flexible budget" when the pacing being
 * explained excludes fixed commitments (see
 * apps/web/lib/budgetSnapshot.ts's flexibleBudget) versus plain "budget"
 * for an unfiltered total.
 */
export function explainPaceStatus(
  pacing: PacePosableInput & Pick<PacingResult, "percentPeriodElapsed">,
  budgetLabel = "budget",
): PaceExplanation {
  const status = derivePaceStatusFromPacing(pacing);
  const elapsed = Math.round(pacing.percentPeriodElapsed);
  const used = Math.round(pacing.percentConsumed);
  return {
    status,
    summary: `${elapsed}% through the period · ${used}% of ${budgetLabel} used`,
  };
}
