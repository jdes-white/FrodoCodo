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
/**
 * Scaled to 41 unique merchants deliberately — the same count as the real
 * failed batch (48 transactions / 41 unique merchants). The 6-merchant
 * version of this test (above/earlier commit) succeeded for 5/6 merchants
 * through this exact code path; this scaled-up version exists specifically
 * to test whether batch SIZE itself (request/response size, token budget,
 * structured-output reliability at scale) is what's different about the
 * real failure, since nothing at small scale reproduced it.
 */
const SYNTHETIC_TRANSACTIONS: ClassifiableTransactionInput[] = [
  { key: "orch-test-coles", originalDescription: "COLES 0092 EVERTON PARK AU", amount: "85.40", direction: "DEBIT" },
  { key: "orch-test-woolworths", originalDescription: "WOOLWORTHS 1234 BRISBANE AU", amount: "62.10", direction: "DEBIT" },
  { key: "orch-test-aldi", originalDescription: "ALDI STORES - BRISBANE AU", amount: "45.00", direction: "DEBIT" },
  { key: "orch-test-kfc", originalDescription: "KFC EVERTON PARK EVERTON PARK", amount: "18.50", direction: "DEBIT" },
  { key: "orch-test-spotify", originalDescription: "SPOTIFY P0A1B2C3D4 SYDNEY AU", amount: "12.99", direction: "DEBIT" },
  { key: "orch-test-optus", originalDescription: "OPTUS MOBILE PAYMENT", amount: "55.00", direction: "DEBIT" },
  { key: "orch-test-bunnings", originalDescription: "BUNNINGS WAREHOUSE CHERMSIDE AU", amount: "34.20", direction: "DEBIT" },
  { key: "orch-test-kmart", originalDescription: "KMART CHERMSIDE AU", amount: "29.00", direction: "DEBIT" },
  { key: "orch-test-target", originalDescription: "TARGET AUSTRALIA CHERMSIDE", amount: "41.50", direction: "DEBIT" },
  { key: "orch-test-jbhifi", originalDescription: "JB HI-FI CHERMSIDE AU", amount: "129.00", direction: "DEBIT" },
  { key: "orch-test-officeworks", originalDescription: "OFFICEWORKS EVERTON PARK", amount: "22.30", direction: "DEBIT" },
  { key: "orch-test-chemistwarehouse", originalDescription: "CHEMIST WAREHOUSE EVERTON PARK", amount: "38.75", direction: "DEBIT" },
  { key: "orch-test-danmurphys", originalDescription: "DAN MURPHY'S EVERTON PARK", amount: "65.00", direction: "DEBIT" },
  { key: "orch-test-bws", originalDescription: "BWS EVERTON PARK AU", amount: "28.00", direction: "DEBIT" },
  { key: "orch-test-7eleven", originalDescription: "7-ELEVEN EVERTON PARK AU", amount: "15.60", direction: "DEBIT" },
  { key: "orch-test-shell", originalDescription: "SHELL COLES EXPRESS EVERTON PARK", amount: "72.10", direction: "DEBIT" },
  { key: "orch-test-bp", originalDescription: "BP EVERTON PARK AU", amount: "68.40", direction: "DEBIT" },
  { key: "orch-test-auspost", originalDescription: "AUSTRALIA POST EVERTON PARK", amount: "12.20", direction: "DEBIT" },
  { key: "orch-test-telstra", originalDescription: "TELSTRA MOBILE PAYMENT", amount: "89.00", direction: "DEBIT" },
  { key: "orch-test-vodafone", originalDescription: "VODAFONE AU MOBILE PLAN", amount: "45.00", direction: "DEBIT" },
  { key: "orch-test-agl", originalDescription: "AGL ELECTRICITY BILL", amount: "210.00", direction: "DEBIT" },
  { key: "orch-test-origin", originalDescription: "ORIGIN ENERGY BILL PAYMENT", amount: "195.00", direction: "DEBIT" },
  { key: "orch-test-netflix", originalDescription: "NETFLIX.COM SYDNEY AU", amount: "16.99", direction: "DEBIT" },
  { key: "orch-test-disneyplus", originalDescription: "DISNEY PLUS SUBSCRIPTION", amount: "13.99", direction: "DEBIT" },
  { key: "orch-test-amazonprime", originalDescription: "AMAZON PRIME AU MEMBERSHIP", amount: "9.99", direction: "DEBIT" },
  { key: "orch-test-youtubepremium", originalDescription: "YOUTUBE PREMIUM GOOGLE", amount: "16.99", direction: "DEBIT" },
  { key: "orch-test-uber", originalDescription: "UBER TRIP SYDNEY AU", amount: "24.50", direction: "DEBIT" },
  { key: "orch-test-ubereats", originalDescription: "UBER EATS SYDNEY AU", amount: "38.20", direction: "DEBIT" },
  { key: "orch-test-menulog", originalDescription: "MENULOG ORDER SYDNEY AU", amount: "32.40", direction: "DEBIT" },
  { key: "orch-test-doordash", originalDescription: "DOORDASH ORDER SYDNEY AU", amount: "29.90", direction: "DEBIT" },
  { key: "orch-test-mcdonalds", originalDescription: "MCDONALD'S EVERTON PARK AU", amount: "14.20", direction: "DEBIT" },
  { key: "orch-test-hungryjacks", originalDescription: "HUNGRY JACK'S CHERMSIDE AU", amount: "13.50", direction: "DEBIT" },
  { key: "orch-test-dominos", originalDescription: "DOMINO'S PIZZA CHERMSIDE", amount: "27.90", direction: "DEBIT" },
  { key: "orch-test-guzmanygomez", originalDescription: "GUZMAN Y GOMEZ CHERMSIDE", amount: "19.50", direction: "DEBIT" },
  { key: "orch-test-boostjuice", originalDescription: "BOOST JUICE CHERMSIDE AU", amount: "9.50", direction: "DEBIT" },
  { key: "orch-test-iga", originalDescription: "IGA EVERTON PARK AU", amount: "48.30", direction: "DEBIT" },
  { key: "orch-test-davidjones", originalDescription: "DAVID JONES SYDNEY AU", amount: "155.00", direction: "DEBIT" },
  { key: "orch-test-myer", originalDescription: "MYER BRISBANE AU", amount: "88.00", direction: "DEBIT" },
  { key: "orch-test-cottonon", originalDescription: "COTTON ON CHERMSIDE AU", amount: "42.00", direction: "DEBIT" },
  { key: "orch-test-hcf", originalDescription: "HCF HEALTH INSURANCE PREMIUM", amount: "245.00", direction: "DEBIT" },
  { key: "orch-test-medibank", originalDescription: "MEDIBANK PRIVATE PREMIUM", amount: "260.00", direction: "DEBIT" },
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
