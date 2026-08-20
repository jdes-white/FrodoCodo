"use client";

import { useMemo, useState } from "react";
import { applyScenario, type ScenarioAdjustment } from "@frodocodo/domain";
import { formatAUD, toMoney } from "@frodocodo/shared";

interface CategoryOption {
  categoryId: string;
  name: string;
  bucketName: string;
  allocation: number;
}

/**
 * Runs entirely client-side — applyScenario is pure, deterministic TS with
 * no I/O, so there's no reason to round-trip to the server for an
 * instant "what if" preview (§27). The AI layer never computes this; it can
 * only narrate a result already produced here.
 */
type Direction = "REDUCE" | "INCREASE";

export function ScenarioModeller({ categories }: { categories: CategoryOption[] }) {
  const [categoryId, setCategoryId] = useState(categories[0]?.categoryId ?? "");
  const [direction, setDirection] = useState<Direction>("REDUCE");
  const [percent, setPercent] = useState(10);

  const result = useMemo(() => {
    if (!categoryId) return null;
    const adjustment: ScenarioAdjustment = {
      categoryId,
      label: "Scenario",
      type: direction === "REDUCE" ? "REDUCE_BY_PERCENT" : "INCREASE_BY_PERCENT",
      value: percent,
    };
    return applyScenario(
      categories.map((c) => ({ categoryId: c.categoryId, categoryName: c.name, allocation: toMoney(c.allocation) })),
      [adjustment],
    );
  }, [categoryId, direction, percent, categories]);

  const affected = result?.lines.find((l) => l.categoryId === categoryId);

  return (
    <div className="flex flex-col gap-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex overflow-hidden rounded-lg border" style={{ borderColor: "var(--color-border)" }}>
          {(["REDUCE", "INCREASE"] as const).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDirection(d)}
              className="px-2.5 py-1 text-sm"
              style={{
                background: direction === d ? "var(--color-accent-soft)" : "transparent",
                color: direction === d ? "var(--color-accent)" : "var(--color-text-muted)",
              }}
            >
              {d === "REDUCE" ? "Reduce" : "Increase"}
            </button>
          ))}
        </div>
        <select
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          className="rounded-lg border px-2 py-1"
          style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}
        >
          {categories.map((c) => (
            <option key={c.categoryId} value={c.categoryId}>
              {c.bucketName} · {c.name}
            </option>
          ))}
        </select>
        <span>by</span>
        <input
          type="number"
          min={0}
          max={100}
          value={percent}
          onChange={(e) => setPercent(Number(e.target.value))}
          className="w-16 rounded-lg border px-2 py-1"
          style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}
        />
        <span>%</span>
      </div>

      {affected && result && (
        <p className="rounded-xl p-3" style={{ background: "var(--color-accent-soft)" }}>
          {affected.categoryName} would go from {formatAUD(affected.allocation)} to {formatAUD(affected.adjustedAllocation)},
          {result.netChange.greaterThanOrEqualTo(0)
            ? ` freeing up ${formatAUD(result.netChange)} for savings or buffer.`
            : ` using an extra ${formatAUD(result.netChange.abs())} from elsewhere in the budget.`}
        </p>
      )}
    </div>
  );
}
