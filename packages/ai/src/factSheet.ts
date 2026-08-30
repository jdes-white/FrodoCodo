import type { PaceStatus } from "@frodocodo/domain";

/**
 * The ONLY data the model ever sees for a request (§22). Every field here is
 * a value the application already calculated deterministically — the model
 * explains it, it never receives raw account numbers, full transaction
 * history, or anything not required for the specific question being asked.
 * All money is pre-formatted to AUD strings so the response-validator can
 * check every dollar figure the model states against this exact set (§45).
 *
 * `status` is the same canonical `PaceStatus` (packages/domain/src/
 * pacePosition.ts) every UI status pill uses — not a separate AI-only
 * classification. This is what makes it possible to guarantee the AI can
 * never describe a household's position differently than the pill sitting
 * right next to its answer: both are the exact same enum value, computed
 * by the exact same function, from the exact same PacingResult.
 */
export interface BucketFact {
  name: string;
  allocation: string;
  spent: string;
  remaining: string;
  status: PaceStatus;
  projectedEndOfPeriod?: string;
}

export interface TransactionFact {
  merchant: string;
  amount: string;
  date: string;
  category: string;
}

export interface ComparisonFact {
  label: string;
  value: string;
}

export interface FinancialFactSheet {
  budgetPeriod: {
    startDate: string;
    endDate: string;
    percentElapsed: number;
  };
  totals: {
    allocation: string;
    spent: string;
    remaining: string;
    status: PaceStatus;
    projectedEndOfPeriod?: string;
  };
  buckets: BucketFact[];
  notableTransactions?: TransactionFact[];
  comparisons?: ComparisonFact[];
}

const MONEY_PATTERN = /-?\$[\d,]+(?:\.\d{1,2})?/g;

/** Every dollar figure a narrative is allowed to state, derived from the fact sheet itself. */
export function allowedMoneyValues(factSheet: FinancialFactSheet): Set<string> {
  const values = new Set<string>();
  const record = (v: string | undefined) => {
    if (v) values.add(v);
  };

  record(factSheet.totals.allocation);
  record(factSheet.totals.spent);
  record(factSheet.totals.remaining);
  record(factSheet.totals.projectedEndOfPeriod);

  for (const bucket of factSheet.buckets) {
    record(bucket.allocation);
    record(bucket.spent);
    record(bucket.remaining);
    record(bucket.projectedEndOfPeriod);
  }
  for (const tx of factSheet.notableTransactions ?? []) {
    record(tx.amount);
  }
  for (const comparison of factSheet.comparisons ?? []) {
    record(comparison.value);
  }

  return values;
}

/**
 * A narrative is only trustworthy if every dollar figure it states came
 * from the fact sheet we supplied — this is what stops the model from
 * quietly inventing or miscalculating a number (§21, §45).
 */
export function narrativeCitesOnlyKnownFigures(narrative: string, factSheet: FinancialFactSheet): boolean {
  const allowed = allowedMoneyValues(factSheet);
  const mentioned = narrative.match(MONEY_PATTERN) ?? [];
  return mentioned.every((value) => allowed.has(normalizeMoneyToken(value)) || allowed.has(value));
}

function normalizeMoneyToken(value: string): string {
  // Tolerate a leading "-$X" in the narrative matching a bare "$X" fact (sign is prose, not data).
  return value.startsWith("-") ? value.slice(1) : value;
}
