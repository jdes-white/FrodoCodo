import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Deliberately narrow: only `lib/**` pure logic that has zero server-only/
 * Next.js/React dependency is unit-tested this way — everything else in
 * this app (pages, server actions, DB-backed lib functions) is exercised
 * by the real Next.js dev server via Playwright (see e2e/), since a
 * plain Node test runner can't resolve "server-only" or render React.
 * See lib/__tests__/pacePosition.test.ts for what this config exists for.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
