import { MockProvider } from "./mockProvider.js";
import { BasiqProvider } from "./basiq/basiqProvider.js";
import { BasiqHttpClient } from "./basiq/httpClient.js";
import type { FinancialDataProvider } from "./types.js";

/**
 * Resolves which `FinancialDataProvider` adapter backs live sync — the one
 * place `FINANCIAL_PROVIDER`/`BASIQ_API_KEY` are read. Swapping providers
 * is this function changing, not a rewrite of any caller (§7). Used by
 * both apps/worker (scheduled sync) and apps/web (the disconnect action,
 * which needs the same adapter to call `disconnectConnection`) — moved
 * here (not left worker-local) specifically so both apps share one
 * instantiation path rather than duplicating the FINANCIAL_PROVIDER
 * switch.
 */
export function createFinancialProvider(): FinancialDataProvider {
  const providerName = process.env.FINANCIAL_PROVIDER ?? "mock";

  if (providerName === "mock") return new MockProvider();

  if (providerName === "basiq") {
    const apiKey = process.env.BASIQ_API_KEY;
    if (!apiKey) {
      throw new Error(
        "FINANCIAL_PROVIDER=basiq requires BASIQ_API_KEY to be set. See docs/basiq-integration.md before ever setting this in a real environment.",
      );
    }
    return new BasiqProvider(new BasiqHttpClient(apiKey));
  }

  throw new Error(
    `Unknown FINANCIAL_PROVIDER "${providerName}". Only "mock" and "basiq" are wired in this repo — ` +
      "see docs/basiq-integration.md before adding another live adapter.",
  );
}
