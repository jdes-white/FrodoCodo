import { toMoney, type Money } from "@frodocodo/shared";

/**
 * Prisma's Decimal and our own decimal.js Money can end up as distinct
 * module instances depending on how pnpm hoists dependencies, so
 * `instanceof` isn't reliable across that boundary. Always round-trip
 * through a string at the DB boundary instead of passing a Prisma Decimal
 * straight into toMoney().
 */
export function fromPrismaDecimal(value: unknown): Money {
  if (value === null || value === undefined) return toMoney(0);
  return toMoney(String(value));
}
