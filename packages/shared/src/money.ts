import Decimal from "decimal.js";

/**
 * Canonical money type for all financial-domain packages (domain, ledger,
 * providers, ai). Always arbitrary-precision decimal — never a JS `number` —
 * so budget arithmetic can never drift from floating-point rounding.
 *
 * Prisma's own `Decimal` is structurally compatible at the DB boundary;
 * `toMoney` accepts anything decimal.js can parse (string, number, Decimal-like).
 */
export type Money = Decimal;

/** Anything `toMoney` accepts — the type public APIs should take from callers. */
export type MoneyInput = Decimal.Value;

export function toMoney(value: Decimal.Value): Money {
  return new Decimal(value);
}

export const ZERO: Money = new Decimal(0);

export function sumMoney(values: Money[]): Money {
  return values.reduce((acc, v) => acc.plus(v), new Decimal(0));
}

export function clampMin(value: Money, min: Money = ZERO): Money {
  return value.lessThan(min) ? min : value;
}

export function formatAUD(value: Money): string {
  const negative = value.isNegative();
  const abs = value.abs().toFixed(2);
  const [whole, cents] = abs.split(".") as [string, string];
  const withThousands = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}$${withThousands}.${cents}`;
}

export function percentage(numerator: Money, denominator: Money): number {
  if (denominator.isZero()) return 0;
  return numerator.dividedBy(denominator).times(100).toNumber();
}
