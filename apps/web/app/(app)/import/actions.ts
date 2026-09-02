"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/session";
import { importScreenshotBatch, type ScreenshotFileInput, type ScreenshotImportSummary } from "@/lib/screenshotImport";
import { getScreenshotVisionExtractor } from "@/lib/screenshotExtractorFactory";

/**
 * Batch screenshot transaction import — any household member can use it
 * (matching reclassify/notes-style mutations elsewhere, not the admin-only
 * bar applied to connecting/disconnecting a live provider). See
 * apps/web/lib/screenshotImport.ts for the full pipeline and its privacy
 * lifecycle (screenshots are read into memory here and never written
 * anywhere durable).
 */

export type ImportActionState = { status: "idle" } | { status: "error"; error: string } | { status: "success"; summary: ScreenshotImportSummary };

const MAX_FILES = 60;
const MAX_FILE_BYTES = 15 * 1024 * 1024;

export async function processScreenshotImport(_prevState: ImportActionState, formData: FormData): Promise<ImportActionState> {
  const session = await requireSession();

  const uploaded = formData.getAll("screenshots").filter((f): f is File => f instanceof File && f.size > 0);
  if (uploaded.length === 0) {
    return { status: "error", error: "Choose at least one screenshot." };
  }
  if (uploaded.length > MAX_FILES) {
    return { status: "error", error: `Choose at most ${MAX_FILES} screenshots at a time.` };
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
    return { status: "error", error: "None of the selected files were readable images." };
  }

  try {
    const extractor = getScreenshotVisionExtractor();
    const summary = await importScreenshotBatch(inputs, session.householdId, session.userId, extractor);

    revalidatePath("/transactions");
    revalidatePath("/");
    revalidatePath("/insights");
    revalidatePath("/settings");

    return { status: "success", summary };
  } catch (err) {
    return { status: "error", error: err instanceof Error ? err.message : "Something went wrong processing the screenshots." };
  }
}
