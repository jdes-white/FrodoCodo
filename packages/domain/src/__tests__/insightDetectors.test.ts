import { describe, expect, it } from "vitest";
import { toMoney } from "@frodocodo/shared";
import { calculatePacing } from "../pacing.js";
import {
  detectProjectedOverspend,
  detectUnusualCategoryIncrease,
  detectSpendingSpike,
  detectRecurringMerchants,
  recurringFindingsToInsights,
  detectUnusuallyLargeTransactions,
  detectDuplicateLookingCharges,
  type MerchantOccurrence,
} from "../insightDetectors.js";

describe("detectProjectedOverspend", () => {
  it("flags a bucket whose projection exceeds its allocation", () => {
    const pacing = calculatePacing({
      period: { startDate: "2026-08-01", endDate: "2026-08-31" },
      asOf: "2026-08-16",
      allocation: 400,
      spentToDate: 320,
      trailingSpend: 140,
      trailingWindowDays: 7,
    });
    const insights = detectProjectedOverspend([{ bucketId: "b1", bucketName: "Lifestyle", pacing }], "2026-08");
    expect(insights).toHaveLength(1);
    expect(insights[0]!.type).toBe("PROJECTED_OVERSPEND");
    expect(insights[0]!.dedupeKey).toBe("projected-overspend:2026-08:b1");
  });

  it("does not flag a bucket projected to finish under budget", () => {
    const pacing = calculatePacing({
      period: { startDate: "2026-08-01", endDate: "2026-08-31" },
      asOf: "2026-08-16",
      allocation: 1000,
      spentToDate: 200,
      trailingSpend: 70,
      trailingWindowDays: 7,
    });
    expect(detectProjectedOverspend([{ bucketId: "b1", bucketName: "Lifestyle", pacing }], "2026-08")).toHaveLength(0);
  });
});

describe("detectUnusualCategoryIncrease", () => {
  it("flags a category that increased significantly vs the prior period", () => {
    const insights = detectUnusualCategoryIncrease(
      [{ categoryId: "dining", categoryName: "Dining", currentTotal: toMoney(480), priorTotal: toMoney(240) }],
      "2026-08",
    );
    expect(insights).toHaveLength(1);
    expect(insights[0]!.summary).toContain("Dining");
  });

  it("ignores small-dollar noise even if the percentage increase is large", () => {
    const insights = detectUnusualCategoryIncrease(
      [{ categoryId: "misc", categoryName: "Misc", currentTotal: toMoney(20), priorTotal: toMoney(5) }],
      "2026-08",
    );
    expect(insights).toHaveLength(0);
  });

  it("does not flag a category that stayed flat", () => {
    const insights = detectUnusualCategoryIncrease(
      [{ categoryId: "groceries", categoryName: "Groceries", currentTotal: toMoney(650), priorTotal: toMoney(630) }],
      "2026-08",
    );
    expect(insights).toHaveLength(0);
  });
});

describe("detectSpendingSpike", () => {
  it("flags trailing spend materially above the normal rate", () => {
    const insight = detectSpendingSpike(toMoney(400), toMoney(150), "past 7 days", "spike:2026-08-14");
    expect(insight?.type).toBe("SPENDING_SPIKE");
    expect(insight?.severity).toBe("WARNING");
  });

  it("does not flag spend close to the normal rate", () => {
    expect(detectSpendingSpike(toMoney(160), toMoney(150), "past 7 days", "spike:2026-08-14")).toBeNull();
  });
});

describe("detectRecurringMerchants / recurringFindingsToInsights", () => {
  const netflixOccurrences: MerchantOccurrence[] = [
    { transactionId: "t1", merchantMatchKey: "netflix", merchantName: "Netflix", amount: toMoney(24.99), transactionDate: "2026-05-05" },
    { transactionId: "t2", merchantMatchKey: "netflix", merchantName: "Netflix", amount: toMoney(24.99), transactionDate: "2026-06-05" },
    { transactionId: "t3", merchantMatchKey: "netflix", merchantName: "Netflix", amount: toMoney(24.99), transactionDate: "2026-07-05" },
    { transactionId: "t4", merchantMatchKey: "netflix", merchantName: "Netflix", amount: toMoney(24.99), transactionDate: "2026-08-05" },
  ];

  it("identifies a fixed-amount monthly merchant as a likely subscription", () => {
    const findings = detectRecurringMerchants(netflixOccurrences);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.isLikelySubscription).toBe(true);

    const insights = recurringFindingsToInsights(findings, "2026-08");
    expect(insights[0]!.type).toBe("SUBSCRIPTION_DETECTED");
    expect(insights[0]!.evidenceTransactionIds).toEqual(["t1", "t2", "t3", "t4"]);
  });

  it("does not flag a merchant visited fewer than the minimum number of times", () => {
    const findings = detectRecurringMerchants(netflixOccurrences.slice(0, 2));
    expect(findings).toHaveLength(0);
  });

  it("does not flag genuinely irregular visits to the same store", () => {
    const irregular: MerchantOccurrence[] = [
      { transactionId: "t1", merchantMatchKey: "woolworths", merchantName: "Woolworths", amount: toMoney(60), transactionDate: "2026-05-01" },
      { transactionId: "t2", merchantMatchKey: "woolworths", merchantName: "Woolworths", amount: toMoney(140), transactionDate: "2026-05-03" },
      { transactionId: "t3", merchantMatchKey: "woolworths", merchantName: "Woolworths", amount: toMoney(85), transactionDate: "2026-06-20" },
      { transactionId: "t4", merchantMatchKey: "woolworths", merchantName: "Woolworths", amount: toMoney(95), transactionDate: "2026-08-11" },
    ];
    // Interval gaps of 2, 48, and 52 days are far too inconsistent to be "regular".
    const findings = detectRecurringMerchants(irregular);
    expect(findings).toHaveLength(0);
  });
});

describe("detectUnusuallyLargeTransactions", () => {
  it("flags a transaction well above the category's typical spend", () => {
    const insights = detectUnusuallyLargeTransactions(
      [{ transactionId: "t1", merchantName: "JB Hi-Fi", amount: toMoney(900), categoryAverage: toMoney(120) }],
      3,
      "2026-08",
    );
    expect(insights).toHaveLength(1);
  });

  it("does not flag a transaction in line with the category average", () => {
    const insights = detectUnusuallyLargeTransactions(
      [{ transactionId: "t1", merchantName: "Woolworths", amount: toMoney(140), categoryAverage: toMoney(110) }],
      3,
      "2026-08",
    );
    expect(insights).toHaveLength(0);
  });
});

describe("detectDuplicateLookingCharges", () => {
  it("flags two identical-amount charges at the same merchant/account within a day", () => {
    const insights = detectDuplicateLookingCharges([
      { transactionId: "t1", accountId: "acc1", merchantMatchKey: "bp", merchantName: "BP", amount: toMoney(85), transactionDate: "2026-08-10" },
      { transactionId: "t2", accountId: "acc1", merchantMatchKey: "bp", merchantName: "BP", amount: toMoney(85), transactionDate: "2026-08-10" },
    ]);
    expect(insights).toHaveLength(1);
    expect(insights[0]!.evidenceTransactionIds).toEqual(["t1", "t2"]);
  });

  it("does not flag two different-amount charges at the same merchant", () => {
    const insights = detectDuplicateLookingCharges([
      { transactionId: "t1", accountId: "acc1", merchantMatchKey: "bp", merchantName: "BP", amount: toMoney(85), transactionDate: "2026-08-10" },
      { transactionId: "t2", accountId: "acc1", merchantMatchKey: "bp", merchantName: "BP", amount: toMoney(60), transactionDate: "2026-08-10" },
    ]);
    expect(insights).toHaveLength(0);
  });
});
