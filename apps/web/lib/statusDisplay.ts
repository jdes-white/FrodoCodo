import type { PacingStatus } from "@frodocodo/shared";

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
