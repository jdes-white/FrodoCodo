"use client";

import { useActionState } from "react";
import { processScreenshotImport, type ImportActionState } from "./actions";
import { Card } from "@/components/Card";

const INITIAL_STATE: ImportActionState = { status: "idle" };

/**
 * Phone-first: a single native file picker (iOS/Android photo picker or
 * Files app both work with `<input type="file" multiple accept="image/*">`
 * with zero extra plumbing) submitting the whole batch in one request.
 * `useActionState` is what lets this show the concise result summary
 * inline without a page navigation — the first use of this pattern in the
 * app, justified specifically because this is the one flow that needs an
 * immediate, structured result rather than a redirect.
 */
export function ImportScreenshotsForm() {
  const [state, formAction, isPending] = useActionState(processScreenshotImport, INITIAL_STATE);

  return (
    <Card as="section" className="flex flex-col gap-4">
      <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
        Select every screenshot you have — any bank, any order, overlapping is fine. FrodoCodo works out the rest and
        never keeps the images themselves.
      </p>

      <form action={formAction} className="flex flex-col gap-3">
        <input type="file" name="screenshots" accept="image/*" multiple required className="text-sm" />
        <button
          type="submit"
          disabled={isPending}
          className="self-start rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          style={{ background: "var(--color-accent)" }}
        >
          {isPending ? "Processing…" : "Upload and process"}
        </button>
      </form>

      {state.status === "error" && (
        <p className="text-sm" style={{ color: "var(--status-behind)" }}>
          {state.error}
        </p>
      )}

      {state.status === "success" && (
        <div className="rounded-xl border p-4 text-sm" style={{ borderColor: "var(--color-border)" }}>
          <p className="font-medium">
            {state.summary.screenshotsProcessed} screenshot{state.summary.screenshotsProcessed === 1 ? "" : "s"} processed
          </p>
          <ul className="mt-2 flex flex-col gap-1" style={{ color: "var(--color-text-muted)" }}>
            <li>
              {state.summary.sourcesDetected.length} source{state.summary.sourcesDetected.length === 1 ? "" : "s"} detected
              {state.summary.sourcesDetected.length > 0 ? ` (${state.summary.sourcesDetected.join(", ")})` : ""}
            </li>
            <li>
              {state.summary.transactionsFound} transaction{state.summary.transactionsFound === 1 ? "" : "s"} found
            </li>
            <li>{state.summary.newTransactions} new</li>
            <li>{state.summary.alreadyKnown} already known</li>
            {state.summary.needsReview > 0 && <li>{state.summary.needsReview} need review</li>}
            {state.summary.screenshotsUnrecognized > 0 && (
              <li>
                {state.summary.screenshotsUnrecognized} screenshot{state.summary.screenshotsUnrecognized === 1 ? "" : "s"} couldn&apos;t be read
              </li>
            )}
          </ul>
          {state.summary.needsReview > 0 && (
            <a href="/transactions?needsReviewOnly=1" className="mt-3 inline-block text-sm font-medium" style={{ color: "var(--color-accent)" }}>
              Review flagged transactions →
            </a>
          )}
        </div>
      )}
    </Card>
  );
}
