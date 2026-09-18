import { toMoney, ZERO, clampMin, formatCompactAUD, type Money, type MoneyInput } from "@frodocodo/shared";

/**
 * North Star (§ long-term direction, distinct from Plan's short-term
 * budgeting): the household's progress toward reduced employment
 * dependency. Pure, deterministic, no I/O — same layering as pacing.ts/
 * spendPace.ts. The primary metric is Employment Dependency:
 *
 *   dependency% = max(0, lifestyleTarget - sustainableIncome) / lifestyleTarget * 100
 *
 * Deliberately NOT salary / total income — a household can keep earning a
 * salary and still be at 0% dependency once sustainable non-employment
 * income covers the full lifestyle target. Work becomes optional, not
 * prohibited.
 */

export interface NorthStarAssumptions {
  lifestyleTarget: Money;
  employmentIncome: Money;
  investedAssetsToday: Money;
  /** 0-1 fraction of invested assets treated as cash-yield-bearing. */
  incomeProducingPortion: number;
  /** 0-1 fraction, annual cash yield on the income-producing portion. */
  cashYield: number;
  /** 0-1 fraction, annual capital growth — used only for the projection, never added into sustainable income directly (§4). */
  capitalGrowthAssumption: number;
  reinvestInvestmentIncome: boolean;
  plannedAnnualContribution: Money;
  /** Already after-tax and after associated costs (§3). */
  sideBusinessIncome: Money;
  otherPassiveIncome: Money;
  timeHorizonYears: number;
}

/**
 * Current income-producing capacity of the invested asset base. Recomputed
 * from whatever the asset base *currently* is — never frozen at an
 * original figure (§4's worked example: $70k -> $150k changes this from
 * $1,400 to $3,000, same portion/yield assumptions).
 */
export function investmentIncomeCapacity(investedAssets: Money, incomeProducingPortion: number, cashYield: number): Money {
  return investedAssets.times(incomeProducingPortion).times(cashYield);
}

/**
 * Investment cash yield + side-business/hustle income + other passive
 * income. Investment cash yield counts whether currently spent or
 * reinvested (§3) — this measures *capacity* to fund lifestyle
 * independently, not current withdrawals. Capital growth is deliberately
 * excluded (§4) — it's a growth-in-asset-value assumption, not income.
 */
export function sustainableNonEmploymentIncome(
  inputs: Pick<NorthStarAssumptions, "investedAssetsToday" | "incomeProducingPortion" | "cashYield" | "sideBusinessIncome" | "otherPassiveIncome">,
): Money {
  const investmentIncome = investmentIncomeCapacity(inputs.investedAssetsToday, inputs.incomeProducingPortion, inputs.cashYield);
  return investmentIncome.plus(inputs.sideBusinessIncome).plus(inputs.otherPassiveIncome);
}

/** Floored at 0 — sustainable income exceeding the lifestyle target never goes negative. */
export function employmentDependency(lifestyleTarget: Money, sustainableIncome: Money): number {
  if (lifestyleTarget.isZero()) return 0;
  const uncovered = clampMin(lifestyleTarget.minus(sustainableIncome), ZERO);
  return uncovered.dividedBy(lifestyleTarget).times(100).toNumber();
}

/** Employment income minus the lifestyle target — feeds the default planned investment contribution. */
export function availableSurplus(employmentIncome: Money, lifestyleTarget: Money): Money {
  return employmentIncome.minus(lifestyleTarget);
}

/** Independent income required to reach a given dependency level (§7's dial exploration formula). */
export function requiredIndependentIncomeForDependency(lifestyleTarget: Money, dependencyPercent: number): Money {
  const clamped = Math.min(Math.max(dependencyPercent, 0), 100);
  // Kept entirely in Decimal space (never `1 - clamped / 100` as a plain JS
  // float subtraction first) — that would introduce binary floating-point
  // error (e.g. 1 - 90/100 = 0.09999999999999998) into an otherwise exact
  // Decimal calculation.
  return lifestyleTarget.times(toMoney(100).minus(clamped)).dividedBy(100);
}

/**
 * The next 10-point milestone *below* the current dependency (§8) — e.g.
 * 99.3% -> 90, 90.0% -> 80 (once you're *at* a milestone, the next one is
 * the following step down, not the same one again), 0% -> 0 (nothing left
 * to cross).
 */
export function nextDependencyMilestone(currentDependencyPercent: number): number {
  if (currentDependencyPercent <= 0) return 0;
  let candidate = Math.floor(currentDependencyPercent / 10) * 10;
  if (candidate >= currentDependencyPercent) candidate -= 10;
  return Math.max(0, candidate);
}

export interface YearProjection {
  year: number;
  investedAssets: Money;
  investmentIncomeCapacity: Money;
}

/**
 * Directional only (§5) — not a guaranteed forecast. Each year the asset
 * base grows by the capital growth assumption, plus the planned
 * contribution, plus that year's cash income if reinvestment is on.
 * Income-producing capacity is recomputed fresh each year from the
 * then-current asset base (matching §4's own worked example), which is
 * why this doesn't split the base into separate income/growth
 * sub-portions that compound differently — that precision isn't
 * something a "what direction are we heading" projection needs.
 */
export function projectNorthStar(inputs: NorthStarAssumptions, years: number): YearProjection[] {
  const results: YearProjection[] = [];
  let assets = inputs.investedAssetsToday;

  for (let year = 0; year <= years; year++) {
    const incomeCapacity = investmentIncomeCapacity(assets, inputs.incomeProducingPortion, inputs.cashYield);
    results.push({ year, investedAssets: assets, investmentIncomeCapacity: incomeCapacity });

    if (year < years) {
      const reinvested = inputs.reinvestInvestmentIncome ? incomeCapacity : ZERO;
      assets = assets.times(1 + inputs.capitalGrowthAssumption).plus(inputs.plannedAnnualContribution).plus(reinvested);
    }
  }

  return results;
}

/**
 * Deterministic "worth considering" one-liner (§10) — no AI call. Written
 * so a future FinancialIntelligenceService-style call could generate this
 * instead, fed only a small whitelisted North Star summary object (never
 * raw transactions/account data) — see apps/web/lib/northStar.ts for where
 * that boundary would sit. For V1 this template is the whole
 * implementation, which the spec explicitly allows.
 */
export function worthConsideringInsight(currentDependencyPercent: number, lifestyleTarget: Money, currentIndependentIncome: Money): string {
  if (currentDependencyPercent <= 0) {
    return "You've reached full independence — work is optional.";
  }
  const milestone = nextDependencyMilestone(currentDependencyPercent);
  const required = requiredIndependentIncomeForDependency(lifestyleTarget, milestone);
  const gap = clampMin(required.minus(currentIndependentIncome), ZERO);
  return `Another ${formatCompactAUD(gap)} of independent income gets you below ${milestone}% dependency.`;
}

export function toNorthStarAssumptions(input: {
  lifestyleTarget: MoneyInput;
  employmentIncome: MoneyInput;
  investedAssetsToday: MoneyInput;
  incomeProducingPortion: number;
  cashYield: number;
  capitalGrowthAssumption: number;
  reinvestInvestmentIncome: boolean;
  plannedAnnualContribution: MoneyInput;
  sideBusinessIncome: MoneyInput;
  otherPassiveIncome: MoneyInput;
  timeHorizonYears: number;
}): NorthStarAssumptions {
  return {
    lifestyleTarget: toMoney(input.lifestyleTarget),
    employmentIncome: toMoney(input.employmentIncome),
    investedAssetsToday: toMoney(input.investedAssetsToday),
    incomeProducingPortion: input.incomeProducingPortion,
    cashYield: input.cashYield,
    capitalGrowthAssumption: input.capitalGrowthAssumption,
    reinvestInvestmentIncome: input.reinvestInvestmentIncome,
    plannedAnnualContribution: toMoney(input.plannedAnnualContribution),
    sideBusinessIncome: toMoney(input.sideBusinessIncome),
    otherPassiveIncome: toMoney(input.otherPassiveIncome),
    timeHorizonYears: input.timeHorizonYears,
  };
}
