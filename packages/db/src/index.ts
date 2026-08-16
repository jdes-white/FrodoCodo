import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var __frodocodoPrisma: PrismaClient | undefined;
}

/**
 * Neon's Vercel integration doesn't always name the connection string
 * DATABASE_URL — depending on how the database was provisioned it can also
 * be POSTGRES_PRISMA_URL / POSTGRES_URL (pooled) or DATABASE_URL_UNPOOLED /
 * POSTGRES_URL_NON_POOLING (direct). The runtime app wants the pooled one.
 * Mirrors packages/db/scripts/resolveDatabaseUrl.mjs — kept as a separate
 * small copy since that one runs via plain `node` at build time, before
 * this package's TS/ESM tooling is available. See docs/deployment.md.
 */
function resolveDatabaseUrl(): string {
  const candidates = ["DATABASE_URL", "POSTGRES_PRISMA_URL", "POSTGRES_URL", "DATABASE_URL_UNPOOLED", "POSTGRES_URL_NON_POOLING"];
  for (const name of candidates) {
    const value = process.env[name];
    if (value) return value;
  }
  throw new Error(
    `No database connection string found. Checked: ${candidates.join(", ")}. ` +
      "Set DATABASE_URL, or attach a Postgres integration that does.",
  );
}

export const prisma = globalThis.__frodocodoPrisma ?? new PrismaClient({ datasourceUrl: resolveDatabaseUrl() });

if (process.env.NODE_ENV !== "production") {
  globalThis.__frodocodoPrisma = prisma;
}

export * from "@prisma/client";
export { seedDemoHousehold, type SeedResult } from "./seedHousehold.js";
