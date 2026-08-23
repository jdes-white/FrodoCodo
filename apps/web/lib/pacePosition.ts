import type { PaceStatus } from "@frodocodo/domain";
import { derivePaceGradientPosition } from "@frodocodo/domain";

/**
 * CSS-specific companion to packages/domain/src/pacePosition.ts (which
 * stays pure — no CSS/React/Next per CLAUDE.md). Two different color
 * treatments from the same underlying difference number:
 *
 *  - The status pill uses a plain, discrete lookup (paceStatusColorVar /
 *    paceStatusSoftColorVar) — one of exactly five named colors, easy to
 *    reason about and easy to keep accessible.
 *  - The arc itself uses a genuinely continuous blend (paceGradientColor)
 *    so it reads as a temperature gauge rather than five traffic-light
 *    states — built with CSS color-mix() over the same --pace-* custom
 *    properties, so the blend is computed by the browser at paint time
 *    and therefore still resolves correctly for whichever theme
 *    (light/dark) is active, exactly like every other themed color in
 *    this app. Only the blend *ratio* (a plain number) is computed here.
 */

export function paceStatusColorVar(status: PaceStatus): string {
  switch (status) {
    case "COMFORTABLY_AHEAD":
      return "var(--pace-comfortable)";
    case "AHEAD_OF_PLAN":
      return "var(--pace-ahead)";
    case "ON_TRACK":
      return "var(--pace-neutral)";
    case "SLIGHTLY_OVER_PACE":
      return "var(--pace-over)";
    case "OVER_PACE":
      return "var(--pace-critical)";
  }
}

export function paceStatusSoftColorVar(status: PaceStatus): string {
  switch (status) {
    case "COMFORTABLY_AHEAD":
      return "var(--pace-comfortable-soft)";
    case "AHEAD_OF_PLAN":
      return "var(--pace-ahead-soft)";
    case "ON_TRACK":
      return "var(--pace-neutral-soft)";
    case "SLIGHTLY_OVER_PACE":
      return "var(--pace-over-soft)";
    case "OVER_PACE":
      return "var(--pace-critical-soft)";
  }
}

/** Ascending gradient position (0..1, see derivePaceGradientPosition) -> CSS custom property name at each stop. */
const GRADIENT_STOPS: Array<{ position: number; varName: string }> = [
  { position: 0, varName: "--pace-comfortable" },
  { position: 0.35, varName: "--pace-ahead" },
  { position: 0.5, varName: "--pace-neutral" },
  { position: 0.65, varName: "--pace-over" },
  { position: 1, varName: "--pace-critical" },
];

/**
 * A `color-mix()` CSS expression that blends the two --pace-* stops
 * bracketing this difference's gradient position, at the right local
 * ratio — the continuous "temperature gauge" the arc's stroke uses.
 */
export function paceGradientColor(difference: number): string {
  const position = derivePaceGradientPosition(difference);

  for (let i = 0; i < GRADIENT_STOPS.length - 1; i++) {
    const from = GRADIENT_STOPS[i]!;
    const to = GRADIENT_STOPS[i + 1]!;
    if (position < from.position || position > to.position) continue;

    const span = to.position - from.position;
    const localT = span === 0 ? 0 : (position - from.position) / span;
    const toPercent = Math.round(localT * 100);
    if (toPercent <= 0) return `var(${from.varName})`;
    if (toPercent >= 100) return `var(${to.varName})`;
    return `color-mix(in srgb, var(${to.varName}) ${toPercent}%, var(${from.varName}) ${100 - toPercent}%)`;
  }

  // Unreachable given derivePaceGradientPosition's own 0..1 clamp, but a
  // safe fallback rather than an undefined stroke color if it ever isn't.
  return `var(${GRADIENT_STOPS[GRADIENT_STOPS.length - 1]!.varName})`;
}
