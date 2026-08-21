"use client";

import { useActionState, useRef } from "react";
import { askCoach, type AskState } from "./actions";

const SUGGESTIONS = [
  "Why are we behind this month?",
  "What changed compared with last month?",
  "How could we create another $500 of buffer next month?",
];

export function AskCoach() {
  const [state, formAction, isPending] = useActionState(askCoach, {});
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="flex flex-col gap-3">
      <form action={formAction} className="flex gap-2">
        <input
          ref={inputRef}
          name="question"
          placeholder="Ask a question about your budget…"
          defaultValue={state.question}
          // 16px (text-base) is deliberate, not decorative: iOS Safari
          // auto-zooms the whole page on focus for any input rendered
          // below 16px, which is what was making the field feel zoomed in
          // and the Ask button hard to reach. Fixing the input's own size
          // is the mobile-safe way to prevent that zoom — disabling
          // pinch-zoom at the viewport level would "fix" it by taking away
          // an accessibility feature instead.
          className="min-w-0 flex-1 rounded-xl border px-3 py-2 text-base"
          style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}
        />
        <button
          type="submit"
          disabled={isPending}
          className="shrink-0 rounded-xl px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          style={{ background: "var(--color-accent)" }}
        >
          {isPending ? "…" : "Ask"}
        </button>
      </form>

      {!state.answer && (
        <div className="flex flex-wrap gap-1.5">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => {
                if (inputRef.current) {
                  inputRef.current.value = s;
                  inputRef.current.focus();
                }
              }}
              className="rounded-full border px-2.5 py-1 text-xs transition hover:opacity-80"
              style={{ borderColor: "var(--color-border)", color: "var(--color-text-muted)" }}
            >
              {s}
            </button>
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
