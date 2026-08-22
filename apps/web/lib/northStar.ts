import "server-only";
import { prisma } from "@frodocodo/db";
import type { NorthStarAssumptions as NorthStarAssumptionsRow } from "@frodocodo/db";
import { toMoney, type Money } from "@frodocodo/shared";
import {
  toNorthStarAssumptions,
  employmentDependency,
  sustainableNonEmploymentIncome,
  availableSurplus,
  nextDependencyMilestone,
  requiredIndependentIncomeForDependency,
  worthConsideringInsight,
  projectNorthStar,
  type NorthStarAssumptions,
  type YearProjection,
} from "@frodocodo/domain";
import { fromPrismaDecimal } from "./decimal";

/** V1 starting assumptions (§2 of the spec) — used only the first time a
 * household visits North Star; every later value comes from the database. */
const DEFAULTS = {
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
  targetEmploymentDependency: 0,
};

/** Household-level, not per-user (§18) — both household members see and can edit the same row. */
export async function getOrCreateNorthStarAssumptions(householdId: string): Promise<NorthStarAssumptionsRow> {
  const existing = await prisma.northStarAssumptions.findUnique({ where: { householdId } });
  if (existing) return existing;
  return prisma.northStarAssumptions.create({ data: { householdId, ...DEFAULTS } });
}

function toDomainInputs(row: NorthStarAssumptionsRow): NorthStarAssumptions {
  return toNorthStarAssumptions({
    lifestyleTarget: fromPrismaDecimal(row.lifestyleTarget),
    employmentIncome: fromPrismaDecimal(row.employmentIncome),
    investedAssetsToday: fromPrismaDecimal(row.investedAssetsToday),
    incomeProducingPortion: fromPrismaDecimal(row.incomeProducingPortion).toNumber(),
    cashYield: fromPrismaDecimal(row.cashYield).toNumber(),
    capitalGrowthAssumption: fromPrismaDecimal(row.capitalGrowthAssumption).toNumber(),
    reinvestInvestmentIncome: row.reinvestInvestmentIncome,
    plannedAnnualContribution: fromPrismaDecimal(row.plannedAnnualContribution),
    sideBusinessIncome: fromPrismaDecimal(row.sideBusinessIncome),
    otherPassiveIncome: fromPrismaDecimal(row.otherPassiveIncome),
    timeHorizonYears: row.timeHorizonYears,
  });
}

export interface NorthStarSnapshot {
  raw: NorthStarAssumptionsRow;
  inputs: NorthStarAssumptions;
  independentIncome: Money;
  dependencyPercent: number;
  surplus: Money;
  milestone: number;
  milestoneRequiredIncome: Money;
  milestoneGap: Money;
  worthConsidering: string;
  targetEmploymentDependency: number;
  projection: YearProjection[];
}

/**
 * The single source of truth North Star's two panels are both built from —
 * same pattern as apps/web/lib/budgetSnapshot.ts for Home/Plan/Insights:
 * computed fresh from the deterministic domain engine, never cached in a
 * way that could drift from the stored assumptions.
 */
export async function getNorthStarSnapshot(householdId: string): Promise<NorthStarSnapshot> {
  const raw = await getOrCreateNorthStarAssumptions(householdId);
  const inputs = toDomainInputs(raw);

  const independentIncome = sustainableNonEmploymentIncome(inputs);
  const dependencyPercent = employmentDependency(inputs.lifestyleTarget, independentIncome);
  const surplus = availableSurplus(inputs.employmentIncome, inputs.lifestyleTarget);
  const milestone = nextDependencyMilestone(dependencyPercent);
  const milestoneRequiredIncome = requiredIndependentIncomeForDependency(inputs.lifestyleTarget, milestone);
  const milestoneGap = milestoneRequiredIncome.minus(independentIncome);
  const worthConsidering = worthConsideringInsight(dependencyPercent, inputs.lifestyleTarget, independentIncome);
  const projection = projectNorthStar(inputs, inputs.timeHorizonYears);

  return {
    raw,
    inputs,
    independentIncome,
    dependencyPercent,
    surplus,
    milestone,
    milestoneRequiredIncome,
    milestoneGap: milestoneGap.isNegative() ? toMoney(0) : milestoneGap,
    worthConsidering,
    targetEmploymentDependency: fromPrismaDecimal(raw.targetEmploymentDependency).toNumber(),
    projection,
  };
}
