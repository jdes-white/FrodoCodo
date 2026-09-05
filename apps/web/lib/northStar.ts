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

/**
 * Self-heals the `NorthStarAssumptions` table on an existing production
 * database that predates this feature. CLAUDE.md's deployment rules
 * deliberately keep `prisma migrate deploy` out of container start (it
 * needs `DIRECT_URL`, which Render doesn't set — see
 * apps/web/scripts/start.sh and render.yaml) and migrations are otherwise
 * applied by hand — but nobody has run this one by hand against the live
 * Neon database yet, so `prisma.northStarAssumptions.*` throws
 * `PrismaClientKnownRequestError P2021` ("table does not exist") on every
 * request, crashing the whole page.
 *
 * Rather than requiring a manual migration step, this lazily creates the
 * exact same table/index/constraint the committed migration
 * (packages/db/prisma/migrations/20260822113229_add_north_star_assumptions)
 * defines, using `IF NOT EXISTS` / a guarded `DO` block so it's a no-op
 * everywhere the migration *has* already been applied (every other
 * environment, and this same database after the first successful heal).
 * It runs over the ordinary pooled `DATABASE_URL` connection — each
 * statement here is a single top-level DDL command, which pgbouncer's
 * transaction pooling mode handles fine; no advisory lock or direct
 * connection is needed the way `prisma migrate deploy` requires.
 *
 * Cached per-process so normal request traffic doesn't re-run DDL on
 * every call once healed; concurrent cold starts across instances are
 * still safe because every statement is independently idempotent.
 *
 * If someone later runs `prisma migrate deploy` by hand against a
 * database this already healed, Prisma will report the migration as
 * pending but the table as already present — resolve that with
 * `prisma migrate resolve --applied 20260822113229_add_north_star_assumptions`
 * rather than editing this function.
 */
let northStarTableEnsured: Promise<void> | null = null;

function ensureNorthStarTable(): Promise<void> {
  if (!northStarTableEnsured) {
    northStarTableEnsured = (async () => {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "NorthStarAssumptions" (
          "id" TEXT NOT NULL,
          "householdId" TEXT NOT NULL,
          "lifestyleTarget" DECIMAL(14,2) NOT NULL,
          "employmentIncome" DECIMAL(14,2) NOT NULL,
          "investedAssetsToday" DECIMAL(14,2) NOT NULL,
          "incomeProducingPortion" DECIMAL(6,4) NOT NULL,
          "cashYield" DECIMAL(6,4) NOT NULL,
          "capitalGrowthAssumption" DECIMAL(6,4) NOT NULL,
          "reinvestInvestmentIncome" BOOLEAN NOT NULL DEFAULT true,
          "plannedAnnualContribution" DECIMAL(14,2) NOT NULL,
          "sideBusinessIncome" DECIMAL(14,2) NOT NULL DEFAULT 0,
          "otherPassiveIncome" DECIMAL(14,2) NOT NULL DEFAULT 0,
          "timeHorizonYears" INTEGER NOT NULL DEFAULT 10,
          "targetEmploymentDependency" DECIMAL(5,2) NOT NULL DEFAULT 0,
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" TIMESTAMP(3) NOT NULL,
          CONSTRAINT "NorthStarAssumptions_pkey" PRIMARY KEY ("id")
        );
      `);
      await prisma.$executeRawUnsafe(`
        CREATE UNIQUE INDEX IF NOT EXISTS "NorthStarAssumptions_householdId_key" ON "NorthStarAssumptions"("householdId");
      `);
      await prisma.$executeRawUnsafe(`
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'NorthStarAssumptions_householdId_fkey') THEN
            ALTER TABLE "NorthStarAssumptions"
              ADD CONSTRAINT "NorthStarAssumptions_householdId_fkey"
              FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;
          END IF;
        END $$;
      `);
    })().catch((error) => {
      // Don't poison future requests with a permanently-rejected cached
      // promise if this attempt failed transiently (e.g. a cold-start DB
      // hiccup) — let the next call retry the heal.
      northStarTableEnsured = null;
      throw error;
    });
  }
  return northStarTableEnsured;
}

/** Household-level, not per-user (§18) — both household members see and can edit the same row. */
export async function getOrCreateNorthStarAssumptions(householdId: string): Promise<NorthStarAssumptionsRow> {
  await ensureNorthStarTable();
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
