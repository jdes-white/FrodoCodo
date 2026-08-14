import { formatAUD, percentage, toMoney, type Money, type MoneyInput } from "@frodocodo/shared";
import type { PacingResult } from "./pacing.js";

/**
 * Deterministic pattern detectors (§26). These produce structured findings
 * from data the app already calculated — the LLM may explain/prioritize
 * them in natural language later, but discovery itself never depends on a
 * model call, so insights keep working even when the AI provider is down.
 */
export type DetectedInsightType =
  | "PROJECTED_OVERSPEND"
  | "UNUSUAL_CATEGORY_INCREASE"
  | "SPENDING_SPIKE"
  | "RECURRING_DETECTED"
  | "SUBSCRIPTION_DETECTED"
  | "UNUSUALLY_LARGE_TRANSACTION"
  | "DUPLICATE_LOOKING_CHARGE";

export type InsightSeverity = "INFO" | "NOTICE" | "WARNING";

export interface DetectedInsight {
  type: DetectedInsightType;
  severity: InsightSeverity;
  title: string;
  summary: string;
  dedupeKey: string;
  evidenceTransactionIds: string[];
}

// ---------- Projected overspend ----------

export interface BucketPacing {
  bucketId: string;
  bucketName: string;
  pacing: PacingResult;
}

export function detectProjectedOverspend(buckets: BucketPacing[], periodKey: string): DetectedInsight[] {
  return buckets
    .filter((b) => b.pacing.projectedVariance.greaterThan(0) && b.pacing.allocation.greaterThan(0))
    .map((b) => ({
      type: "PROJECTED_OVERSPEND" as const,
      severity: severityForOverspendRatio(percentage(b.pacing.projectedVariance, b.pacing.allocation)),
      title: `${b.bucketName} is projected to finish over budget`,
      summary: `At the current pace, ${b.bucketName} is projected to finish approximately ${formatSigned(b.pacing.projectedVariance)} over its ${formatAUD(b.pacing.allocation)} allocation.`,
      dedupeKey: `projected-overspend:${periodKey}:${b.bucketId}`,
      evidenceTransactionIds: [],
    }));
}

function severityForOverspendRatio(overspendPercent: number): InsightSeverity {
  if (overspendPercent >= 20) return "WARNING";
  if (overspendPercent >= 5) return "NOTICE";
  return "INFO";
}

// ---------- Unusual category increase (period-over-period, §26) ----------

export interface CategoryPeriodTotal {
  categoryId: string;
  categoryName: string;
  currentTotal: Money;
  priorTotal: Money;
}

const UNUSUAL_INCREASE_MIN_RATIO = 0.3; // 30% up on last period
const UNUSUAL_INCREASE_MIN_ABSOLUTE = 50; // ignore noise on tiny categories

export function detectUnusualCategoryIncrease(
  categories: CategoryPeriodTotal[],
  periodKey: string,
): DetectedInsight[] {
  return categories
    .filter((c) => {
      const delta = c.currentTotal.minus(c.priorTotal);
      if (delta.lessThanOrEqualTo(UNUSUAL_INCREASE_MIN_ABSOLUTE)) return false;
      if (c.priorTotal.isZero()) return true;
      return delta.dividedBy(c.priorTotal).greaterThanOrEqualTo(UNUSUAL_INCREASE_MIN_RATIO);
    })
    .map((c) => {
      const delta = c.currentTotal.minus(c.priorTotal);
      return {
        type: "UNUSUAL_CATEGORY_INCREASE" as const,
        severity: "NOTICE" as const,
        title: `${c.categoryName} spend is up compared with last period`,
        summary: `${c.categoryName} is ${formatSigned(delta)} higher than at the same point last period (${formatAUD(c.priorTotal)} -> ${formatAUD(c.currentTotal)}).`,
        dedupeKey: `unusual-category-increase:${periodKey}:${c.categoryId}`,
        evidenceTransactionIds: [],
      };
    });
}

// ---------- Spending spike (trailing window vs normal weekly rate, §26) ----------

export function detectSpendingSpike(
  trailingWindowSpend: Money,
  normalWeeklyRate: Money,
  windowLabel: string,
  dedupeKey: string,
  spikeRatioThreshold = 1.5,
): DetectedInsight | null {
  if (normalWeeklyRate.isZero()) return null;
  const ratio = trailingWindowSpend.dividedBy(normalWeeklyRate).toNumber();
  if (ratio < spikeRatioThreshold) return null;

  return {
    type: "SPENDING_SPIKE",
    severity: ratio >= 2 ? "WARNING" : "NOTICE",
    title: "Discretionary spending is materially above normal",
    summary: `Spending over the ${windowLabel} is ${formatAUD(trailingWindowSpend)}, well above the normal rate of ${formatAUD(normalWeeklyRate)} for a comparable period.`,
    dedupeKey,
    evidenceTransactionIds: [],
  };
}

// ---------- Recurring / subscription detection (§26, §41) ----------

export interface MerchantOccurrence {
  transactionId: string;
  merchantMatchKey: string;
  merchantName: string;
  amount: MoneyInput;
  transactionDate: string; // YYYY-MM-DD
}

const RECURRING_MIN_OCCURRENCES = 3;
const RECURRING_INTERVAL_TOLERANCE_DAYS = 4;
const SUBSCRIPTION_AMOUNT_TOLERANCE_RATIO = 0.02;

export interface RecurringMerchantFinding {
  merchantMatchKey: string;
  merchantName: string;
  occurrences: MerchantOccurrence[];
  averageIntervalDays: number;
  isLikelySubscription: boolean;
}

/** Groups by merchant, then flags merchants with regular timing (and near-identical amounts => likely subscriptions). */
export function detectRecurringMerchants(occurrences: MerchantOccurrence[]): RecurringMerchantFinding[] {
  const byMerchant = new Map<string, MerchantOccurrence[]>();
  for (const occ of occurrences) {
    const list = byMerchant.get(occ.merchantMatchKey) ?? [];
    list.push(occ);
    byMerchant.set(occ.merchantMatchKey, list);
  }

  const findings: RecurringMerchantFinding[] = [];
  for (const [key, occs] of byMerchant) {
    if (occs.length < RECURRING_MIN_OCCURRENCES) continue;
    const sorted = [...occs].sort((a, b) => a.transactionDate.localeCompare(b.transactionDate));
    const intervals = sorted.slice(1).map((o, i) => daysBetween(sorted[i]!.transactionDate, o.transactionDate));
    const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const isRegular = intervals.every((d) => Math.abs(d - avgInterval) <= RECURRING_INTERVAL_TOLERANCE_DAYS);
    if (!isRegular) continue;

    const amounts = sorted.map((o) => toMoney(o.amount).toNumber());
    const avgAmount = amounts.reduce((a, b) => a + b, 0) / amounts.length;
    const isSameAmount = amounts.every((a) => Math.abs(a - avgAmount) / avgAmount <= SUBSCRIPTION_AMOUNT_TOLERANCE_RATIO);

    findings.push({
      merchantMatchKey: key,
      merchantName: sorted[0]!.merchantName,
      occurrences: sorted,
      averageIntervalDays: avgInterval,
      isLikelySubscription: isSameAmount && avgInterval <= 35,
    });
  }
  return findings;
}

export function recurringFindingsToInsights(findings: RecurringMerchantFinding[], periodKey: string): DetectedInsight[] {
  return findings.map((f) => ({
    type: f.isLikelySubscription ? "SUBSCRIPTION_DETECTED" : "RECURRING_DETECTED",
    severity: "INFO",
    title: f.isLikelySubscription ? `${f.merchantName} looks like a subscription` : `${f.merchantName} looks like a recurring payment`,
    summary: `${f.merchantName} has charged the household ${f.occurrences.length} times roughly every ${Math.round(f.averageIntervalDays)} days.`,
    dedupeKey: `recurring:${periodKey}:${f.merchantMatchKey}`,
    evidenceTransactionIds: f.occurrences.map((o) => o.transactionId),
  }));
}

// ---------- Unusually large transaction ----------

export function detectUnusuallyLargeTransactions(
  transactions: Array<{ transactionId: string; merchantName: string; amount: MoneyInput; categoryAverage: MoneyInput }>,
  multiplierThreshold = 3,
  periodKey: string,
): DetectedInsight[] {
  return transactions
    .map((t) => ({ ...t, amount: toMoney(t.amount), categoryAverage: toMoney(t.categoryAverage) }))
    .filter((t) => t.categoryAverage.greaterThan(0) && t.amount.dividedBy(t.categoryAverage).greaterThanOrEqualTo(multiplierThreshold))
    .map((t) => ({
      type: "UNUSUALLY_LARGE_TRANSACTION" as const,
      severity: "NOTICE" as const,
      title: `Unusually large transaction at ${t.merchantName}`,
      summary: `A ${formatAUD(t.amount)} charge at ${t.merchantName} is well above the household's typical spend in that category (${formatAUD(t.categoryAverage)}).`,
      dedupeKey: `large-transaction:${periodKey}:${t.transactionId}`,
      evidenceTransactionIds: [t.transactionId],
    }));
}

// ---------- Duplicate-looking charge (user-facing nudge, distinct from ledger-level dedupe) ----------

export interface DuplicateLookingCandidate {
  transactionId: string;
  accountId: string;
  merchantMatchKey: string;
  merchantName: string;
  amount: MoneyInput;
  transactionDate: string;
}

export function detectDuplicateLookingCharges(candidates: DuplicateLookingCandidate[], windowDays = 1): DetectedInsight[] {
  const insights: DetectedInsight[] = [];
  const sorted = [...candidates]
    .map((c) => ({ ...c, amount: toMoney(c.amount) }))
    .sort((a, b) => a.transactionDate.localeCompare(b.transactionDate));

  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const a = sorted[i]!;
      const b = sorted[j]!;
      if (daysBetween(a.transactionDate, b.transactionDate) > windowDays) break;
      if (a.accountId !== b.accountId) continue;
      if (a.merchantMatchKey !== b.merchantMatchKey) continue;
      if (!a.amount.equals(b.amount)) continue;

      insights.push({
        type: "DUPLICATE_LOOKING_CHARGE",
        severity: "NOTICE",
        title: `Possible duplicate charge at ${a.merchantName}`,
        summary: `Two ${formatAUD(a.amount)} charges at ${a.merchantName} were posted within a day of each other — worth checking this isn't a double charge.`,
        dedupeKey: `duplicate-looking:${a.transactionId}:${b.transactionId}`,
        evidenceTransactionIds: [a.transactionId, b.transactionId],
      });
    }
  }
  return insights;
}

function daysBetween(a: string, b: string): number {
  return (Date.parse(b) - Date.parse(a)) / 86_400_000;
}

function formatSigned(value: Money): string {
  return value.isNegative() ? `-${formatAUD(value.abs())}` : formatAUD(value);
}
