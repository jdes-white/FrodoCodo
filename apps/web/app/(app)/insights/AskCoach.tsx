"use client";

import { useActionState } from "react";
import { askCoach, type AskState } from "./actions";

const SUGGESTIONS = [
  "Why are we behind this month?",
  "What changed compared with last month?",
  "How could we create another $500 of buffer next month?",
];

export function AskCoach() {
  const [state, formAction, isPending] = useActionState(askCoach, {});

  return (
    <div className="flex flex-col gap-3">
      <form action={formAction} className="flex gap-2">
        <input
          name="question"
          placeholder="Ask a question about your budget…"
          defaultValue={state.question}
          className="flex-1 rounded-xl border px-3 py-2 text-sm"
          style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}
        />
        <button
          type="submit"
          disabled={isPending}
          className="rounded-xl px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          style={{ background: "var(--color-accent)" }}
        >
          {isPending ? "…" : "Ask"}
        </button>
      </form>

      {!state.answer && (
        <div className="flex flex-wrap gap-1.5">
          {SUGGESTIONS.map((s) => (
            <span
              key={s}
              className="rounded-full border px-2.5 py-1 text-xs"
              style={{ borderColor: "var(--color-border)", color: "var(--color-text-muted)" }}
            >
              {s}
            </span>
          ))}
        </div>
      )}

      {state.answer && (
        <div className="rounded-xl p-3 text-sm" style={{ background: "var(--color-accent-soft)" }}>
          <p>{state.answer}</p>
          {state.source === "FALLBACK_TEMPLATE" && (
            <p className="mt-1 text-xs" style={{ color: "var(--color-text-muted)" }}>
              (answered from your budget data directly)
            </p>
          )}
        </div>
      )}
    </div>
  );
}
