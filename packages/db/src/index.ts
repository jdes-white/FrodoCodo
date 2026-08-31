import { PrismaClient } from "@prisma/client";
import { logDbEvent } from "./dbErrors.js";

declare global {
  // eslint-disable-next-line no-var
  var __frodocodoPrisma: PrismaClient | undefined;
}

/**
 * Standard Prisma Client, native query-engine binary (see the generator
 * block in packages/db/prisma/schema.prisma for why — this app previously
 * ran on Vercel's serverless platform, where packaging that binary
 * correctly proved unreliable, but in a normal Docker/Linux container
 * there's no function-packaging step for it to go missing from). Reads its
 * connection string directly from `env("DATABASE_URL")` in the schema's
 * datasource block — no manual resolution needed here.
 */
function createPrismaClient(): PrismaClient {
  logDbEvent("prisma_client_created");
  return new PrismaClient();
}

export const prisma = globalThis.__frodocodoPrisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  // Dev hot-reload re-evaluates this module on every edit — cache across
  // reloads so each one doesn't open a fresh set of connections.
  globalThis.__frodocodoPrisma = prisma;
}

export * from "@prisma/client";
export { seedDemoHousehold, type SeedResult } from "./seedHousehold.js";
export { sanitizeDbError, logDbEvent, logDbError, type SanitizedDbError } from "./dbErrors.js";
export { encryptForStorage, decryptFromStorage, type EncryptedPayloadEnvelope } from "./payloadEncryption.js";
