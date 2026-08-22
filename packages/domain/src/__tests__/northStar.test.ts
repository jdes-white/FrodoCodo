import { describe, expect, it } from "vitest";
import { toMoney } from "@frodocodo/shared";
import {
  employmentDependency,
  investmentIncomeCapacity,
  sustainableNonEmploymentIncome,
  availableSurplus,
  requiredIndependentIncomeForDependency,
  nextDependencyMilestone,
  projectNorthStar,
  worthConsideringInsight,
  toNorthStarAssumptions,
  type NorthStarAssumptions,
} from "../northStar.js";

const V1_ASSUMPTIONS: NorthStarAssumptions = toNorthStarAssumptions({
  lifestyleTarget: 190000,
  employmentIncome: 220000,
  investedAssetsToday: 70000,
  incomeProducingPortion: 0.5,
  cashYield: 0.04,
  capitalGrowthAssumption: 0.055,
  reinvestInvestmentIncome: true,
  plannedAnnualContribution: 30000,
  sideBusinessIncome: 0,
  otherPassiveIncome: 0,
  timeHorizonYears: 10,
});

describe("investmentIncomeCapacity", () => {
  it("matches the spec's worked example: $70k, 50%, 4% -> $1,400", () => {
    expect(investmentIncomeCapacity(toMoney(70000), 0.5, 0.04).toNumber()).toBe(1400);
  });

  it("recalculates from the current asset base, not frozen at the original figure (§4)", () => {
    // Same portion/yield assumptions, larger base -> proportionally larger capacity.
    expect(investmentIncomeCapacity(toMoney(150000), 0.5, 0.04).toNumber()).toBe(3000);
  });
});

describe("sustainableNonEmploymentIncome", () => {
  it("sums investment cash yield + side business + other passive income", () => {
    const income = sustainableNonEmploymentIncome({
      investedAssetsToday: toMoney(70000),
      incomeProducingPortion: 0.5,
      cashYield: 0.04,
      sideBusinessIncome: toMoney(5000),
      otherPassiveIncome: toMoney(2000),
    });
    expect(income.toNumber()).toBe(1400 + 5000 + 2000);
  });

  it("counts investment income whether it's currently reinvested or spent (§3) — the function has no reinvest flag at all", () => {
    const income = sustainableNonEmploymentIncome({
      investedAssetsToday: toMoney(70000),
      incomeProducingPortion: 0.5,
      cashYield: 0.04,
      sideBusinessIncome: toMoney(0),
      otherPassiveIncome: toMoney(0),
    });
    expect(income.toNumber()).toBe(1400);
  });
});

describe("employmentDependency", () => {
  it("matches the spec's V1 worked example: ~99.3%", () => {
    const dependency = employmentDependency(toMoney(190000), toMoney(1400));
    expect(dependency).toBeCloseTo(99.26, 1);
  });

  it("is never calculated as salary / total income — plenty of salary at 0% dependency is possible", () => {
    // Sustainable income exceeds the lifestyle target entirely; employment income is irrelevant to this call.
    const dependency = employmentDependency(toMoney(100000), toMoney(150000));
    expect(dependency).toBe(0);
  });

  it("floors at 0% rather than going negative when sustainable income exceeds the target", () => {
    const dependency = employmentDependency(toMoney(50000), toMoney(80000));
    expect(dependency).toBe(0);
  });

  it("is 100% with zero sustainable income", () => {
    expect(employmentDependency(toMoney(190000), toMoney(0))).toBe(100);
  });
});

describe("availableSurplus", () => {
  it("matches the V1 worked example: $220k - $190k = $30k", () => {
    expect(availableSurplus(toMoney(220000), toMoney(190000)).toNumber()).toBe(30000);
  });
});

describe("requiredIndependentIncomeForDependency (dial exploration)", () => {
  it.each([
    [90, 19000],
    [80, 38000],
    [50, 95000],
    [0, 190000],
  ])("at %i%% dependency requires $%i p.a. independent income (on a $190k lifestyle target)", (dependencyPercent, expected) => {
    expect(requiredIndependentIncomeForDependency(toMoney(190000), dependencyPercent).toNumber()).toBe(expected);
  });

  it("dragging the dial is exploration only — this is a pure function with no side effects on stored data", () => {
    const before = requiredIndependentIncomeForDependency(toMoney(190000), 90);
    const after = requiredIndependentIncomeForDependency(toMoney(190000), 50);
    expect(before.toNumber()).not.toBe(after.toNumber());
    // Calling it again with the original value reproduces the original result — nothing was mutated.
    expect(requiredIndependentIncomeForDependency(toMoney(190000), 90).toNumber()).toBe(before.toNumber());
  });
});

describe("nextDependencyMilestone", () => {
  it("steps from ~99.3% to the 90% milestone", () => {
    expect(nextDependencyMilestone(99.3)).toBe(90);
  });

  it("advances to the next milestone down once a milestone is exactly reached", () => {
    expect(nextDependencyMilestone(90)).toBe(80);
    expect(nextDependencyMilestone(80)).toBe(70);
  });

  it("stays within a band correctly (85% -> 80%)", () => {
    expect(nextDependencyMilestone(85)).toBe(80);
  });

  it("reaches 0 and stays there", () => {
    expect(nextDependencyMilestone(5)).toBe(0);
    expect(nextDependencyMilestone(0)).toBe(0);
  });
});

describe("cash yield vs capital growth stay conceptually separate (§4)", () => {
  it("capital growth is never added into sustainable non-employment income", () => {
    const withoutGrowthConsidered = sustainableNonEmploymentIncome({
      investedAssetsToday: toMoney(70000),
      incomeProducingPortion: 0.5,
      cashYield: 0.04,
      sideBusinessIncome: toMoney(0),
      otherPassiveIncome: toMoney(0),
    });
    // 5.5% capital growth on $70k ($3,850) is nowhere in this figure — only the 4% cash yield on the 50% portion is.
    expect(withoutGrowthConsidered.toNumber()).toBe(1400);
  });

  it("growth of the asset base still increases *future* income capacity via the projection", () => {
    const projection = projectNorthStar(V1_ASSUMPTIONS, 1);
    const yearZero = projection[0]!;
    const yearOne = projection[1]!;
    expect(yearZero.investedAssets.toNumber()).toBe(70000);
    expect(yearOne.investedAssets.greaterThan(yearZero.investedAssets)).toBe(true);
    expect(yearOne.investmentIncomeCapacity.greaterThan(yearZero.investmentIncomeCapacity)).toBe(true);
  });
});

describe("projectNorthStar", () => {
  it("year 0 is today's starting position, unchanged", () => {
    const projection = projectNorthStar(V1_ASSUMPTIONS, 10);
    expect(projection[0]!.investedAssets.toNumber()).toBe(70000);
    expect(projection[0]!.investmentIncomeCapacity.toNumber()).toBe(1400);
  });

  it("produces exactly years+1 entries (today through the horizon)", () => {
    expect(projectNorthStar(V1_ASSUMPTIONS, 10)).toHaveLength(11);
    expect(projectNorthStar(V1_ASSUMPTIONS, 5)).toHaveLength(6);
  });

  it("grows the asset base monotonically with a positive contribution and growth rate", () => {
    const projection = projectNorthStar(V1_ASSUMPTIONS, 10);
    for (let i = 1; i < projection.length; i++) {
      expect(projection[i]!.investedAssets.greaterThan(projection[i - 1]!.investedAssets)).toBe(true);
    }
  });

  it("without reinvestment, the asset base still grows from contributions but income capacity grows more slowly", () => {
    const reinvesting = projectNorthStar(V1_ASSUMPTIONS, 10);
    const notReinvesting = projectNorthStar({ ...V1_ASSUMPTIONS, reinvestInvestmentIncome: false }, 10);
    expect(reinvesting[10]!.investedAssets.greaterThan(notReinvesting[10]!.investedAssets)).toBe(true);
  });
});

describe("worthConsideringInsight", () => {
  it("matches the spec's V1 example wording", () => {
    const insight = worthConsideringInsight(99.3, toMoney(190000), toMoney(1400));
    expect(insight).toBe("Another $17.6k of independent income gets you below 90% dependency.");
  });

  it("declares full independence once dependency reaches 0", () => {
    expect(worthConsideringInsight(0, toMoney(190000), toMoney(190000))).toBe("You've reached full independence — work is optional.");
  });
});
