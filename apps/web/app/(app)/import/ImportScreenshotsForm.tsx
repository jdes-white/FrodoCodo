"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/Card";

type ImportState = { status: "idle" } | { status: "error"; error: string } | { status: "success" };

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
 * Server Actions bundle doesn't load correctly.
 *
 * Deliberately does NOT render its own result summary — that used to live
 * only in this component's `useState` and vanished the instant a household
 * member navigated away and came back (the screenshot-to-budget closure
 * pass's headline defect). The upload's actual outcome is durably recorded
 * server-side as an `ImportBatch` (`apps/web/lib/importBatches.ts`) and
 * rendered by the sibling `RecentImportBatches` server component on this
 * same page, which is what survives navigation, a reload, or reopening the
 * app — `router.refresh()` below just makes that section pick up this
 * upload immediately instead of waiting for the next natural page load.
 */
export function ImportScreenshotsForm() {
  const [state, setState] = useState<ImportState>(INITIAL_STATE);
  const [isPending, setIsPending] = useState(false);
  const router = useRouter();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setIsPending(true);
    try {
      const response = await fetch("/api/import", { method: "POST", body: formData });
      const data = (await response.json()) as { summary?: unknown; error?: string };
      if (!response.ok || !data.summary) {
        setState({ status: "error", error: data.error ?? "Something went wrong processing the screenshots." });
      } else {
        setState({ status: "success" });
        event.currentTarget.reset();
        router.refresh();
      }
    } catch {
      // Reaches here when the response itself never arrived intact —
      // `fetch` threw (connection dropped/reset) or the body wasn't valid
      // JSON (e.g. a proxy's own timeout page instead of the app's real
      // response). The most common real cause is the container having been
      // idle and still starting up, or genuine slowness for a large batch —
      // both resolved by waiting and retrying, so say that rather than a
      // bare "something went wrong".
      setState({
        status: "error",
        error:
          "The request didn't complete. If the app had been idle, the server may still be starting up — wait a few seconds and try again.",
      });
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
        <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
          Processed — see Recent imports below.
        </p>
      )}
    </Card>
  );
}
