import { MockProvider } from "./mockProvider.js";
import { BasiqProvider } from "./basiq/basiqProvider.js";
import { BasiqHttpClient } from "./basiq/httpClient.js";
import { buildConsentUiUrl, generateConsentState } from "./basiq/consentUi.js";
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

export interface BasiqConsentUiHandoff {
  /** The hosted Consent UI URL to redirect the household's browser to. */
  url: string;
  /** The state value embedded in `url` — the caller must persist this (e.g. a signed cookie) to verify Basiq's return. */
  state: string;
}

/**
 * Task 7C: the one place a caller (apps/web's connect flow) gets everything
 * needed to redirect a household to Basiq's hosted Consent UI for a given
 * Basiq user — obtains a transient CLIENT_ACCESS token
 * (`BasiqHttpClient.getClientAccessToken`, never cached/persisted, see
 * docs/basiq-integration.md) and builds the URL (`consentUi.ts`). Kept here
 * rather than in `apps/web` so that file never needs to construct a
 * `BasiqHttpClient` or read `BASIQ_API_KEY` itself — `createFinancialProvider`
 * is already the one place in this package that reads that env var.
 *
 * Deliberately NOT part of the `FinancialDataProvider` interface: this is
 * Basiq's own hosted-redirect concept, which MockProvider (and any future
 * non-redirect adapter) has no equivalent for — callers branch on
 * `provider.id === "basiq"` before calling this, exactly as they branch on
 * it for every other Basiq-specific concern already (see basiqProvider.ts's
 * own doc comments).
 */
export async function beginBasiqConsent(
  basiqUserId: string,
  options: { action?: "connect"; institutionId?: string } = {},
): Promise<BasiqConsentUiHandoff> {
  const apiKey = process.env.BASIQ_API_KEY;
  if (!apiKey) {
    throw new Error("beginBasiqConsent requires BASIQ_API_KEY to be set — see docs/basiq-integration.md.");
  }

  const client = new BasiqHttpClient(apiKey);
  const { token } = await client.getClientAccessToken(basiqUserId);
  const state = generateConsentState();
  const url = buildConsentUiUrl({ clientToken: token, state, action: options.action, institutionId: options.institutionId });
  return { url, state };
}
