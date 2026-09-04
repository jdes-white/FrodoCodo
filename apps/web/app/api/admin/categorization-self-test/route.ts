import { NextResponse } from "next/server";
import { prisma } from "@frodocodo/db";
import { getCategorySuggestionExtractor } from "@/lib/categorySuggestionFactory";
import type { CategorySuggestionInput } from "@frodocodo/ai";

/**
 * TEMPORARY, server-triggered self-test — added for the production
 * categorisation diagnosis (48 real transactions / 41 merchants, 0 AI
 * assignments; see commit c3f8696's diagnostics). Exercises the exact same
 * `getCategorySuggestionExtractor()` -> Anthropic -> parse -> threshold
 * path production uses, against SYNTHETIC merchants only (never a real
 * transaction, never a real amount tied to an actual purchase) and this
 * household's REAL category list (names/ids only — already established
 * elsewhere in this codebase as non-sensitive, never financial/identity
 * data). Triggered by a one-off Render Cron Job hitting this endpoint
 * directly (Render's own network has no outbound restriction, unlike the
 * sandbox this diagnosis is being run from) — no phone/browser session
 * needed. Gated by `DIAGNOSTIC_TOKEN`, a token generated solely for this
 * diagnosis and distinct from `SEED_TOKEN`.
 *
 * DELETE this route, the `DIAGNOSTIC_TOKEN` env var, and the cron job that
 * calls it once the defect is established — this is not a permanent
 * feature.
 */
const SYNTHETIC_MERCHANTS: CategorySuggestionInput[] = [
  { key: "self-test-coles", merchantName: "Coles", amount: "85.40", direction: "DEBIT" },
  { key: "self-test-woolworths", merchantName: "Woolworths", amount: "62.10", direction: "DEBIT" },
  { key: "self-test-aldi", merchantName: "Aldi", amount: "45.00", direction: "DEBIT" },
  { key: "self-test-kfc", merchantName: "Kfc Everton Park", amount: "18.50", direction: "DEBIT" },
  { key: "self-test-spotify", merchantName: "Spotify", amount: "12.99", direction: "DEBIT" },
  { key: "self-test-optus", merchantName: "Optus", amount: "55.00", direction: "DEBIT" },
];

export async function POST(request: Request): Promise<NextResponse> {
  const token = request.headers.get("x-diagnostic-token") ?? new URL(request.url).searchParams.get("token");
  const expected = process.env.DIAGNOSTIC_TOKEN;
  if (!expected) {
    return NextResponse.json({ error: "DIAGNOSTIC_TOKEN is not configured on the server" }, { status: 500 });
  }
  if (token !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const household = await prisma.household.findFirst({ select: { id: true } });
  if (!household) {
    return NextResponse.json({ error: "No household found" }, { status: 404 });
  }

  const categories = await prisma.category.findMany({
    where: { householdId: household.id, isArchived: false },
    select: { id: true, name: true },
  });

  const extractor = getCategorySuggestionExtractor();
  const startedAt = Date.now();
  let result: Map<string, { categoryId: string; confidence: number } | null>;
  let errorMessage: string | null = null;
  try {
    result = await extractor(SYNTHETIC_MERCHANTS, categories);
  } catch (err) {
    result = new Map();
    errorMessage = err instanceof Error ? err.message : "unknown error";
  }
  const durationMs = Date.now() - startedAt;

  return NextResponse.json({
    ok: true,
    aiProviderEnv: process.env.AI_PROVIDER ?? null,
    anthropicKeyConfigured: Boolean(process.env.ANTHROPIC_API_KEY),
    anthropicModelEnv: process.env.ANTHROPIC_MODEL ?? "(default)",
    categoryCount: categories.length,
    categoryNames: categories.map((c) => c.name),
    durationMs,
    errorMessage,
    results: Object.fromEntries(result),
  });
}
