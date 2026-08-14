import { MockProvider, type FinancialDataProvider } from "@frodocodo/providers";

/**
 * Resolves which FinancialDataProvider adapter backs live sync. Swapping
 * the real aggregator in later is a config change here, not a rewrite of
 * anything that calls this (§7). See docs/provider-integration.md for what
 * a BasiqProvider adapter needs to implement against this same interface.
 */
export function getProvider(): FinancialDataProvider {
  const providerName = process.env.FINANCIAL_PROVIDER ?? "mock";

  if (providerName === "mock") return new MockProvider();

  throw new Error(
    `Unknown FINANCIAL_PROVIDER "${providerName}". Only "mock" is wired in this repo — ` +
      "see docs/provider-integration.md before adding a live adapter.",
  );
}
