"use server";

import { revalidatePath } from "next/cache";
import { prisma, Prisma } from "@frodocodo/db";
import { requireSession } from "@/lib/session";
import { recordAuditEvent } from "@/lib/audit";
import { getOrCreateNorthStarAssumptions } from "@/lib/northStar";

/**
 * Everyday North Star editing is deliberately NOT admin-gated (§18) — it's
 * a household-level objective both members share, not an admin control
 * like budget allocations or account inclusion.
 *
 * One generic action backs every editable field on Page 2 instead of one
 * action per input. Safety comes from this switch being an explicit
 * whitelist: an unrecognised field name is rejected, and each case returns
 * a properly typed `Prisma.NorthStarAssumptionsUpdateInput` fragment
 * rather than building `{ [field]: value }` from the raw string, which
 * would bypass Prisma's generated update-input types entirely.
 *
 * incomeProducingPortion / cashYield / capitalGrowthAssumption are stored
 * as 0-1 fractions but edited as whole percentages, so they're divided by
 * 100 here; targetEmploymentDependency is already stored 0-100 (§13), so
 * it passes through unchanged.
 */
function buildUpdateData(field: string, raw: number): Prisma.NorthStarAssumptionsUpdateInput {
  switch (field) {
    case "lifestyleTarget":
      return { lifestyleTarget: raw };
    case "employmentIncome":
      return { employmentIncome: raw };
    case "investedAssetsToday":
      return { investedAssetsToday: raw };
    case "plannedAnnualContribution":
      return { plannedAnnualContribution: raw };
    case "sideBusinessIncome":
      return { sideBusinessIncome: raw };
    case "otherPassiveIncome":
      return { otherPassiveIncome: raw };
    case "incomeProducingPortion":
      return { incomeProducingPortion: raw / 100 };
    case "cashYield":
      return { cashYield: raw / 100 };
    case "capitalGrowthAssumption":
      return { capitalGrowthAssumption: raw / 100 };
    case "targetEmploymentDependency":
      return { targetEmploymentDependency: raw };
    case "timeHorizonYears":
      return { timeHorizonYears: Math.round(raw) };
    default:
      throw new Error(`Unknown North Star field: ${field}`);
  }
}

export async function updateNorthStarField(formData: FormData): Promise<void> {
  const session = await requireSession();
  const field = String(formData.get("field"));
  const raw = Number(formData.get("value"));
  if (!Number.isFinite(raw)) throw new Error("Invalid value");

  const data = buildUpdateData(field, raw);

  // Ensures the row exists (first edit for a household created before its
  // first North Star page visit) before the update targets it by householdId.
  await getOrCreateNorthStarAssumptions(session.householdId);
  await prisma.northStarAssumptions.update({ where: { householdId: session.householdId }, data });

  await recordAuditEvent({
    householdId: session.householdId,
    actorUserId: session.userId,
    action: "UPDATE_NORTH_STAR_ASSUMPTION",
    entityType: "NorthStarAssumptions",
    entityId: session.householdId,
    metadata: { field, value: raw },
  });

  revalidatePath("/north-star");
}

export async function toggleReinvestInvestmentIncome(formData: FormData): Promise<void> {
  const session = await requireSession();
  const reinvest = formData.get("reinvest") === "true";

  await getOrCreateNorthStarAssumptions(session.householdId);
  await prisma.northStarAssumptions.update({
    where: { householdId: session.householdId },
    data: { reinvestInvestmentIncome: reinvest },
  });

  await recordAuditEvent({
    householdId: session.householdId,
    actorUserId: session.userId,
    action: "UPDATE_NORTH_STAR_ASSUMPTION",
    entityType: "NorthStarAssumptions",
    entityId: session.householdId,
    metadata: { field: "reinvestInvestmentIncome", value: reinvest },
  });

  revalidatePath("/north-star");
}
