"use client";

import { useState } from "react";
import { runScreenshotBatchRecategorization } from "./actions";
import type { RecategorizationSummary } from "@/lib/recategorizeScreenshotBatch";
import { Card } from "@/components/Card";

type RunState = { status: "idle" } | { status: "error"; error: string } | { status: "success"; summary: RecategorizationSummary };

/**
 * TEMPORARY, ONE-OFF UI — see `@/lib/recategorizeScreenshotBatch`'s doc
 * comment for why this exists and when it's safe to delete (this file,
 * `actions.ts`'s `runScreenshotBatchRecategorization`, and the lib helper
 * itself) — once a run reports `beforeUncategorized: 0` there's nothing
 * left for it to do. Tapping the button is the entire interaction; no
 * terminal, curl, or secret needed, since the admin's own logged-in
 * session is the only credential this requires.
 */
export function RecategorizeScreenshotBatchButton() {
  const [state, setState] = useState<RunState>({ status: "idle" });
  const [isPending, setIsPending] = useState(false);

  async function handleClick() {
    setIsPending(true);
    try {
      const summary = await runScreenshotBatchRecategorization();
      setState({ status: "success", summary });
    } catch (err) {
      setState({ status: "error", error: err instanceof Error ? err.message : "Something went wrong." });
    } finally {
      setIsPending(false);
    }
  }

  return (
    <Card>
      <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
        One-off: re-run AI categorisation against the 3 Sept screenshot-import batch that predates it. Only touches
        transactions from that batch still without a category.
      </p>
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        className="mt-2 self-start rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
        style={{ background: "var(--color-accent)" }}
      >
        {isPending ? "Running…" : "Recategorise Sept 3 batch"}
      </button>

      {state.status === "error" && (
        <p className="mt-2 text-sm" style={{ color: "var(--status-behind)" }}>
          {state.error}
        </p>
      )}

      {state.status === "success" && (
        <div className="mt-3 text-sm" style={{ color: "var(--color-text-muted)" }}>
          <p>Before: {state.summary.beforeUncategorized} uncategorised</p>
          <p>Resolved by existing rule/learned mapping: {state.summary.deterministicResolved}</p>
          <p>
            Sent to AI: {state.summary.transactionsSentToAi} transaction(s) across {state.summary.uniqueMerchantsSentToAi}{" "}
            merchant(s)
          </p>
          <p>Auto-assigned by AI (≥0.80 confidence): {state.summary.aiAutoAssigned}</p>
          <p>Still unresolved: {state.summary.stillUnresolved}</p>
          {state.summary.samples.length > 0 && (
            <ul className="mt-2 list-disc pl-5">
              {state.summary.samples.map((s, i) => (
                <li key={i}>
                  {s.merchantName} → {s.categoryName ?? "(unresolved)"}
                  {s.source ? ` (${s.source}${s.confidence !== null ? `, ${Math.round(s.confidence * 100)}%` : ""})` : ""}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}
