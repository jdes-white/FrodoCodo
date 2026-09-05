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

/** "$17.6k" / "$1.2m" style compact form, for one-line summaries where the
 * full "$17,600.00" would be too long (e.g. North Star's insight line). */
export function formatCompactAUD(value: Money): string {
  const negative = value.isNegative();
  const abs = value.abs();
  const sign = negative ? "-" : "";

  if (abs.greaterThanOrEqualTo(1_000_000)) {
    const millions = abs.dividedBy(1_000_000);
    return `${sign}$${trimTrailingZero(millions)}m`;
  }
  if (abs.greaterThanOrEqualTo(1_000)) {
    const thousands = abs.dividedBy(1_000);
    return `${sign}$${trimTrailingZero(thousands)}k`;
  }
  return formatAUD(value);
}

function trimTrailingZero(value: Money): string {
  const rounded = value.toDecimalPlaces(1);
  return rounded.modulo(1).isZero() ? rounded.toFixed(0) : rounded.toFixed(1);
}
