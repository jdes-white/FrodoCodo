import type { PacingStatus } from "@frodocodo/shared";
import type { SpendPaceStatus } from "@frodocodo/domain";

/** @deprecated in UI copy — kept for the AI fact sheet (apps/web/lib/factSheetBuilder.ts)
 * and anywhere else that still reads PacingResult.pacingStatus directly. New UI should
 * use spendPaceColorVar/spendPaceSoftColorVar with domain's deriveSpendPaceStatus instead —
 * "Ahead of pace"/"Behind pace" read ambiguously (either direction could sound good or bad). */
export function statusLabel(status: PacingStatus): string {
  if (status === "AHEAD") return "Ahead of pace";
  if (status === "BEHIND") return "Behind pace";
  return "On track";
}

export function statusColorVar(status: PacingStatus): string {
  if (status === "AHEAD") return "var(--status-ahead)";
  if (status === "BEHIND") return "var(--status-behind)";
  return "var(--status-on-track)";
}

export function statusSoftColorVar(status: PacingStatus): string {
  if (status === "AHEAD") return "var(--status-ahead-soft)";
  if (status === "BEHIND") return "var(--status-behind-soft)";
  return "var(--status-on-track-soft)";
}

/**
 * Color mapping for domain's SpendPaceStatus (see packages/domain/src/spendPace.ts
 * for why this is a distinct, unambiguous-by-design status from PacingStatus above).
 * Green always favourable; amber/red always need attention.
 */
export function spendPaceColorVar(status: SpendPaceStatus): string {
  switch (status) {
    case "COMFORTABLY_ON_TRACK":
      return "var(--status-ahead)";
    case "ON_TRACK":
      return "var(--status-on-track)";
    case "WATCH_SPENDING":
      return "var(--status-behind)";
    case "OFF_TRACK":
      return "var(--status-off-track)";
  }
}

export function spendPaceSoftColorVar(status: SpendPaceStatus): string {
  switch (status) {
    case "COMFORTABLY_ON_TRACK":
      return "var(--status-ahead-soft)";
    case "ON_TRACK":
      return "var(--status-on-track-soft)";
    case "WATCH_SPENDING":
      return "var(--status-behind-soft)";
    case "OFF_TRACK":
      return "var(--status-off-track-soft)";
  }
}
