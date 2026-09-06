import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/session";
import { importScreenshotBatch, type ScreenshotFileInput } from "@/lib/screenshotImport";
import { getScreenshotVisionExtractor } from "@/lib/screenshotExtractorFactory";
import { getCategorySuggestionExtractor } from "@/lib/categorySuggestionFactory";

/**
 * Batch screenshot transaction import. Deliberately a Route Handler, not a
 * Server Action, despite every other mutation in this app being one — the
 * sanitisation step (packages/ai/src/screenshotSanitizer.ts) depends on
 * `sharp`, a native addon, and Next.js 15.5's Server Actions compile into a
 * separate "action-browser" webpack bundle that does not honour
 * `serverExternalPackages` (next.config.ts) for native modules the way the
 * ordinary server bundle does. A Server Action version of this endpoint
 * threw "Could not load the sharp module using the linux-x64 runtime" at
 * request time — reproducibly, with sharp correctly installed
 * (`node -e "require('sharp')..."` from a plain Node process works fine)
 * and correctly declared in `serverExternalPackages` — because the
 * action-browser compilation bundled sharp's code into its own chunk
 * instead of leaving it as a plain `require()` resolved from node_modules
 * at its real on-disk location, which is what a native addon's loader
 * needs. Route Handlers compile under the standard server bundle, where
 * `serverExternalPackages` works as documented — confirmed by this same
 * sanitizer working correctly once moved here. See
 * apps/web/app/(app)/import/ImportScreenshotsForm.tsx for the client side
 * (a plain `fetch` POST with `FormData`, replacing what would otherwise be
 * a `useActionState` + Server Action pair).
 *
 * Any household member can use this (matches reclassify/notes-style
 * mutations elsewhere, not the admin-only bar applied to connecting/
 * disconnecting a live provider). See apps/web/lib/screenshotImport.ts for
 * the full pipeline and its privacy lifecycle (screenshots are read into
 * memory here and never written anywhere durable).
 */

const MAX_FILES = 60;
const MAX_FILE_BYTES = 15 * 1024 * 1024;

export async function POST(request: Request): Promise<NextResponse> {
  const session = await requireSession();

  const formData = await request.formData();
  const uploaded = formData.getAll("screenshots").filter((f): f is File => f instanceof File && f.size > 0);
  if (uploaded.length === 0) {
    return NextResponse.json({ error: "Choose at least one screenshot." }, { status: 400 });
  }
  if (uploaded.length > MAX_FILES) {
    return NextResponse.json({ error: `Choose at most ${MAX_FILES} screenshots at a time.` }, { status: 400 });
  }

  const inputs: ScreenshotFileInput[] = [];
  for (const file of uploaded) {
    // Fails safe: a non-image or oversized file is silently skipped rather
    // than processed or rejecting the whole batch — the household never
    // has to pre-sort their selection.
    if (!file.type.startsWith("image/")) continue;
    if (file.size > MAX_FILE_BYTES) continue;
    const buffer = Buffer.from(await file.arrayBuffer());
    inputs.push({ buffer, mediaType: file.type });
  }

  if (inputs.length === 0) {
    return NextResponse.json({ error: "None of the selected files were readable images." }, { status: 400 });
  }

  try {
    const extractor = getScreenshotVisionExtractor();
    const categorySuggestionExtractor = getCategorySuggestionExtractor();
    const summary = await importScreenshotBatch(inputs, session.householdId, session.userId, extractor, categorySuggestionExtractor);

    revalidatePath("/transactions");
    revalidatePath("/");
    revalidatePath("/insights");
    revalidatePath("/settings");

    return NextResponse.json({ summary });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Something went wrong processing the screenshots." }, { status: 500 });
  }
}
