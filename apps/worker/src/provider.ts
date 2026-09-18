import { createFinancialProvider, type FinancialDataProvider } from "@frodocodo/providers";

/**
 * Thin re-export — the actual FINANCIAL_PROVIDER/BASIQ_API_KEY resolution
 * lives in packages/providers/src/factory.ts (Task 7A), shared with
 * apps/web's disconnect action so both apps instantiate the exact same
 * adapter rather than duplicating the provider-selection switch.
 */
export function getProvider(): FinancialDataProvider {
  return createFinancialProvider();
}
