import "server-only";
import { prisma } from "@frodocodo/db";
import { getCategorySuggestionExtractor } from "./categorySuggestionFactory";
import type { CategorySuggestionInput } from "@frodocodo/ai";

/**
 * TEMPORARY — production categorisation diagnosis (48 real transactions,
 * 0 AI assignments; see commits c3f8696/dce8cda). Exercises the exact same
 * `getCategorySuggestionExtractor()` -> Anthropic -> parse -> threshold
 * path production uses, against SYNTHETIC merchants only (never a real
 * transaction) and this household's REAL category list (names/ids only —
 * already established elsewhere in this codebase as non-sensitive). Called
 * from two places: `apps/web/instrumentation.ts` (runs it once,
 * automatically, on the next server boot, gated by
 * `RUN_CATEGORIZATION_SELF_TEST_ON_BOOT=1` — no browser/phone session
 * needed at all) and the token-gated
 * `apps/web/app/api/admin/categorization-self-test/route.ts` (a manual
 * fallback). DELETE this file, both call sites, `DIAGNOSTIC_TOKEN`, and
 * `RUN_CATEGORIZATION_SELF_TEST_ON_BOOT` once the defect is established —
 * this is not a permanent feature.
 */
const SYNTHETIC_MERCHANTS: CategorySuggestionInput[] = [
  { key: "self-test-coles", merchantName: "Coles", amount: "85.40", direction: "DEBIT" },
  { key: "self-test-woolworths", merchantName: "Woolworths", amount: "62.10", direction: "DEBIT" },
  { key: "self-test-aldi", merchantName: "Aldi", amount: "45.00", direction: "DEBIT" },
  { key: "self-test-kfc", merchantName: "Kfc Everton Park", amount: "18.50", direction: "DEBIT" },
  { key: "self-test-spotify", merchantName: "Spotify", amount: "12.99", direction: "DEBIT" },
  { key: "self-test-optus", merchantName: "Optus", amount: "55.00", direction: "DEBIT" },
];

export interface CategorizationSelfTestResult {
  aiProviderEnv: string | null;
  anthropicKeyConfigured: boolean;
  anthropicModelEnv: string;
  categoryCount: number;
  categoryNames: string[];
  durationMs: number;
  errorMessage: string | null;
  results: Record<string, { categoryId: string; confidence: number } | null>;
}

export async function runCategorizationSelfTest(): Promise<CategorizationSelfTestResult | { error: string }> {
  const household = await prisma.household.findFirst({ select: { id: true } });
  if (!household) return { error: "No household found" };

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

  return {
    aiProviderEnv: process.env.AI_PROVIDER ?? null,
    anthropicKeyConfigured: Boolean(process.env.ANTHROPIC_API_KEY),
    anthropicModelEnv: process.env.ANTHROPIC_MODEL ?? "(default)",
    categoryCount: categories.length,
    categoryNames: categories.map((c) => c.name),
    durationMs,
    errorMessage,
    results: Object.fromEntries(result),
  };
}
