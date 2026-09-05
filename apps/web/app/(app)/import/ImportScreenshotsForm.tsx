"use client";

import { useState, type FormEvent } from "react";
import type { ScreenshotImportSummary } from "@/lib/screenshotImport";
import { Card } from "@/components/Card";

type ImportState = { status: "idle" } | { status: "error"; error: string } | { status: "success"; summary: ScreenshotImportSummary };

const INITIAL_STATE: ImportState = { status: "idle" };

/**
 * Phone-first: a single native file picker (iOS/Android photo picker or
 * Files app both work with `<input type="file" multiple accept="image/*">`
 * with zero extra plumbing) submitting the whole batch in one request.
 *
 * This posts to `/api/import` (a Route Handler) with a plain `fetch`
 * rather than a Server Action + `useActionState` — see
 * `apps/web/app/api/import/route.ts`'s doc comment for why: the
 * sanitisation step depends on a native addon (`sharp`) that Next's
 * Server Actions bundle doesn't load correctly. The UI/UX is otherwise
 * identical to a Server Action form — one submit, one concise inline
 * result, no page navigation.
 */
export function ImportScreenshotsForm() {
  const [state, setState] = useState<ImportState>(INITIAL_STATE);
  const [isPending, setIsPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setIsPending(true);
    try {
      const response = await fetch("/api/import", { method: "POST", body: formData });
      const data = (await response.json()) as { summary?: ScreenshotImportSummary; error?: string };
      if (!response.ok || !data.summary) {
        setState({ status: "error", error: data.error ?? "Something went wrong processing the screenshots." });
      } else {
        setState({ status: "success", summary: data.summary });
      }
    } catch {
      setState({ status: "error", error: "Something went wrong processing the screenshots." });
    } finally {
      setIsPending(false);
    }
  }

  return (
    <Card as="section" className="flex flex-col gap-4">
      <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
        Select every screenshot you have — any bank, any order, overlapping is fine. FrodoCodo works out the rest and
        never keeps the images themselves.
      </p>

      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
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
            {state.summary.unreadableTransactionCount > 0 && (
              <li style={{ color: "var(--status-behind)" }}>
                {state.summary.unreadableTransactionCount} transaction{state.summary.unreadableTransactionCount === 1 ? "" : "s"} could not be
                reliably read — review required
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
