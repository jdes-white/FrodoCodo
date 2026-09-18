import { describe, expect, it } from "vitest";
import { toMoney } from "@frodocodo/shared";
import { applyScenario } from "../scenario.js";

describe("applyScenario", () => {
  const baseline = [
    { categoryId: "dining", categoryName: "Dining", allocation: toMoney(400) },
    { categoryId: "groceries", categoryName: "Groceries", allocation: toMoney(800) },
    { categoryId: "subscriptions", categoryName: "Subscriptions", allocation: toMoney(60) },
  ];

  it("reduces a category by a fixed weekly-equivalent amount", () => {
    // "reduce dining by $100/week" ≈ $433/month; keep the test simple with a flat amount.
    const result = applyScenario(baseline, [
      { categoryId: "dining", label: "Reduce dining", type: "REDUCE_BY_AMOUNT", value: toMoney(100) },
    ]);
    const dining = result.lines.find((l) => l.categoryId === "dining")!;
    expect(dining.adjustedAllocation.toNumber()).toBe(300);
    expect(result.netChange.toNumber()).toBe(100);
  });

  it("reduces a category by a percentage", () => {
    const result = applyScenario(baseline, [
      { categoryId: "groceries", label: "Cut groceries 10%", type: "REDUCE_BY_PERCENT", value: 10 },
    ]);
    const groceries = result.lines.find((l) => l.categoryId === "groceries")!;
    expect(groceries.adjustedAllocation.toNumber()).toBe(720);
    expect(result.netChange.toNumber()).toBe(80);
  });

  it("removes a recurring subscription entirely", () => {
    const result = applyScenario(baseline, [
      { categoryId: "subscriptions", label: "Cancel subscription", type: "REMOVE", value: 0 },
    ]);
    const subs = result.lines.find((l) => l.categoryId === "subscriptions")!;
    expect(subs.adjustedAllocation.toNumber()).toBe(0);
    expect(result.netChange.toNumber()).toBe(60);
  });

  it("combines multiple adjustments and leaves untouched categories alone", () => {
    const result = applyScenario(baseline, [
      { categoryId: "dining", label: "Reduce dining", type: "REDUCE_BY_AMOUNT", value: toMoney(100) },
      { categoryId: "subscriptions", label: "Cancel subscription", type: "REMOVE", value: 0 },
    ]);
    expect(result.netChange.toNumber()).toBe(160);
    const groceries = result.lines.find((l) => l.categoryId === "groceries")!;
    expect(groceries.delta.toNumber()).toBe(0);
  });

  it("increases a category by a fixed amount", () => {
    const result = applyScenario(baseline, [
      { categoryId: "dining", label: "More dining", type: "INCREASE_BY_AMOUNT", value: toMoney(100) },
    ]);
    const dining = result.lines.find((l) => l.categoryId === "dining")!;
    expect(dining.adjustedAllocation.toNumber()).toBe(500);
    expect(dining.delta.toNumber()).toBe(100);
    // Increasing spends more of the budget, so netChange (original - adjusted) goes negative.
    expect(result.netChange.toNumber()).toBe(-100);
  });

  it("increases a category by a percentage", () => {
    const result = applyScenario(baseline, [
      { categoryId: "groceries", label: "More groceries 10%", type: "INCREASE_BY_PERCENT", value: 10 },
    ]);
    const groceries = result.lines.find((l) => l.categoryId === "groceries")!;
    expect(groceries.adjustedAllocation.toNumber()).toBe(880);
    expect(result.netChange.toNumber()).toBe(-80);
  });

  it("combines a reduction and an increase, netting their effect on the total", () => {
    const result = applyScenario(baseline, [
      { categoryId: "subscriptions", label: "Cancel subscription", type: "REMOVE", value: 0 },
      { categoryId: "groceries", label: "More groceries", type: "INCREASE_BY_AMOUNT", value: toMoney(60) },
    ]);
    expect(result.netChange.toNumber()).toBe(0);
    const groceries = result.lines.find((l) => l.categoryId === "groceries")!;
    expect(groceries.adjustedAllocation.toNumber()).toBe(860);
  });
});
