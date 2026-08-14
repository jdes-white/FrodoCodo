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
export function ScenarioModeller({ categories }: { categories: CategoryOption[] }) {
  const [categoryId, setCategoryId] = useState(categories[0]?.categoryId ?? "");
  const [reductionPercent, setReductionPercent] = useState(10);

  const result = useMemo(() => {
    if (!categoryId) return null;
    const adjustment: ScenarioAdjustment = {
      categoryId,
      label: "Scenario",
      type: "REDUCE_BY_PERCENT",
      value: reductionPercent,
    };
    return applyScenario(
      categories.map((c) => ({ categoryId: c.categoryId, categoryName: c.name, allocation: toMoney(c.allocation) })),
      [adjustment],
    );
  }, [categoryId, reductionPercent, categories]);

  const affected = result?.lines.find((l) => l.categoryId === categoryId);

  return (
    <div className="flex flex-col gap-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span>Reduce</span>
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
          value={reductionPercent}
          onChange={(e) => setReductionPercent(Number(e.target.value))}
          className="w-16 rounded-lg border px-2 py-1"
          style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}
        />
        <span>%</span>
      </div>

      {affected && result && (
        <p className="rounded-xl p-3" style={{ background: "var(--color-accent-soft)" }}>
          {affected.categoryName} would go from {formatAUD(affected.allocation)} to {formatAUD(affected.adjustedAllocation)},
          freeing up {formatAUD(result.netChange)} for savings or buffer.
        </p>
      )}
    </div>
  );
}
