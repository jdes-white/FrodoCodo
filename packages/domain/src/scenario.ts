import { toMoney, ZERO, sumMoney, type Money } from "@frodocodo/shared";

/**
 * Deterministic "what if?" modelling (§27). The AI layer may explain these
 * results in natural language; it must never compute them — every number
 * the user sees originates here.
 */
export type ScenarioAdjustmentType =
  | "REDUCE_BY_AMOUNT"
  | "REDUCE_BY_PERCENT"
  | "SET_ALLOCATION"
  | "REMOVE";

export interface ScenarioAdjustment {
  categoryId: string;
  label: string;
  type: ScenarioAdjustmentType;
  /** Amount (for REDUCE_BY_AMOUNT / SET_ALLOCATION) or percent 0-100 (for REDUCE_BY_PERCENT). */
  value: Money | number;
}

export interface ScenarioBaselineLine {
  categoryId: string;
  categoryName: string;
  allocation: Money;
}

export interface ScenarioLineResult extends ScenarioBaselineLine {
  adjustedAllocation: Money;
  delta: Money; // adjustedAllocation - allocation (negative = savings)
  adjustment?: ScenarioAdjustment;
}

export interface ScenarioResult {
  lines: ScenarioLineResult[];
  totalOriginalAllocation: Money;
  totalAdjustedAllocation: Money;
  /** Positive = the scenario frees up this much budget (increases surplus). */
  netChange: Money;
}

export function applyScenario(
  baseline: ScenarioBaselineLine[],
  adjustments: ScenarioAdjustment[],
): ScenarioResult {
  const adjustmentsByCategory = new Map(adjustments.map((a) => [a.categoryId, a]));

  const lines: ScenarioLineResult[] = baseline.map((line) => {
    const adjustment = adjustmentsByCategory.get(line.categoryId);
    const adjustedAllocation = adjustment
      ? applyAdjustment(line.allocation, adjustment)
      : line.allocation;
    return {
      ...line,
      adjustedAllocation,
      delta: adjustedAllocation.minus(line.allocation),
      adjustment,
    };
  });

  const totalOriginalAllocation = sumMoney(baseline.map((l) => l.allocation));
  const totalAdjustedAllocation = sumMoney(lines.map((l) => l.adjustedAllocation));

  return {
    lines,
    totalOriginalAllocation,
    totalAdjustedAllocation,
    netChange: totalOriginalAllocation.minus(totalAdjustedAllocation),
  };
}

function applyAdjustment(allocation: Money, adjustment: ScenarioAdjustment): Money {
  switch (adjustment.type) {
    case "REDUCE_BY_AMOUNT":
      return allocation.minus(toMoney(adjustment.value as Money));
    case "REDUCE_BY_PERCENT":
      return allocation.times(1 - (adjustment.value as number) / 100);
    case "SET_ALLOCATION":
      return toMoney(adjustment.value as Money);
    case "REMOVE":
      return ZERO;
    default:
      return allocation;
  }
}
