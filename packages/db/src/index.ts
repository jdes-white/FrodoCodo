import { PrismaClient } from "../generated/client/index.js";

declare global {
  // eslint-disable-next-line no-var
  var __frodocodoPrisma: PrismaClient | undefined;
}

export const prisma = globalThis.__frodocodoPrisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.__frodocodoPrisma = prisma;
}

export * from "../generated/client/index.js";
