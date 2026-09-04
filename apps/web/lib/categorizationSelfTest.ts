import "server-only";
import { prisma } from "@frodocodo/db";
import { getCategorySuggestionExtractor } from "./categorySuggestionFactory";
import type { CategorySuggestionInput } from "@frodocodo/ai";
import { classifyTransactionBatch, type ClassifiableTransactionInput } from "@frodocodo/worker";

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

/**
 * The direct-extractor test above proves `getCategorySuggestionExtractor()`
 * -> Anthropic -> parse -> threshold works correctly in isolation. It never
 * exercises `classifyTransactionBatch` — the orchestration layer the real
 * Settings-button run actually goes through (`normalizeMerchant` ->
 * `Merchant` upsert -> `MerchantRule` lookup -> `planCategorySuggestionBatch`
 * -> the extractor -> `finalizeCategoryBatch`). This runs SYNTHETIC,
 * bank-statement-style descriptions (never a real transaction) through
 * that exact orchestration path so a defect specific to it (as opposed to
 * the extractor itself) can be isolated without touching any real data.
 */
const SYNTHETIC_TRANSACTIONS: ClassifiableTransactionInput[] = [
  { key: "orch-test-coles", originalDescription: "COLES 0092 EVERTON PARK AU", amount: "85.40", direction: "DEBIT" },
  { key: "orch-test-woolworths", originalDescription: "WOOLWORTHS 1234 BRISBANE AU", amount: "62.10", direction: "DEBIT" },
  { key: "orch-test-aldi", originalDescription: "ALDI STORES - BRISBANE AU", amount: "45.00", direction: "DEBIT" },
  { key: "orch-test-kfc", originalDescription: "KFC EVERTON PARK EVERTON PARK", amount: "18.50", direction: "DEBIT" },
  { key: "orch-test-spotify", originalDescription: "SPOTIFY P0A1B2C3D4 SYDNEY AU", amount: "12.99", direction: "DEBIT" },
  { key: "orch-test-optus", originalDescription: "OPTUS MOBILE PAYMENT", amount: "55.00", direction: "DEBIT" },
];

export interface OrchestrationSelfTestResult {
  requestedCount: number;
  results: Record<
    string,
    {
      merchantNormalizedName: string;
      categoryId: string | null;
      classificationSource: string | null;
      classificationConfidence: number | null;
      suggestedCategoryId: string | null;
      suggestedCategoryConfidence: number | null;
    }
  >;
  errorMessage: string | null;
}

export async function runOrchestrationSelfTest(): Promise<OrchestrationSelfTestResult | { error: string }> {
  const household = await prisma.household.findFirst({ select: { id: true } });
  if (!household) return { error: "No household found" };

  const extractor = getCategorySuggestionExtractor();
  let errorMessage: string | null = null;
  let outcomes: Awaited<ReturnType<typeof classifyTransactionBatch>> = new Map();
  try {
    outcomes = await classifyTransactionBatch(household.id, SYNTHETIC_TRANSACTIONS, extractor);
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : "unknown error";
  }

  const results: OrchestrationSelfTestResult["results"] = {};
  for (const [key, outcome] of outcomes) {
    results[key] = {
      merchantNormalizedName: outcome.merchantNormalizedName,
      categoryId: outcome.categoryId,
      classificationSource: outcome.classificationSource,
      classificationConfidence: outcome.classificationConfidence,
      suggestedCategoryId: outcome.suggestedCategoryId,
      suggestedCategoryConfidence: outcome.suggestedCategoryConfidence,
    };
  }

  return { requestedCount: SYNTHETIC_TRANSACTIONS.length, results, errorMessage };
}
