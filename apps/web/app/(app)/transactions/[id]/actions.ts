"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@frodocodo/db";
import { requireSession } from "@/lib/session";
import { recordAuditEvent } from "@/lib/audit";

/**
 * §32 corrections/overrides. Every write here is paired with a
 * TransactionClassification row and/or AuditEvent so the household can
 * always see *why* a total changed (§31 trust and explainability), and
 * §12: reclassifying can optionally teach the system by creating a
 * MerchantRule for future transactions from the same merchant.
 */
export async function reclassifyTransaction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const transactionId = String(formData.get("transactionId"));
  const categoryId = String(formData.get("categoryId"));
  const applyToFutureFromMerchant = formData.get("applyToFutureFromMerchant") === "on";

  const transaction = await prisma.transaction.findFirstOrThrow({
    where: { id: transactionId, account: { connection: { householdId: session.householdId } } },
  });

  await prisma.$transaction(async (tx) => {
    await tx.transaction.update({
      where: { id: transactionId },
      data: { categoryId, isUserOverridden: true, classificationSource: "USER", classificationConfidence: 1 },
    });
    await tx.transactionClassification.create({
      data: {
        transactionId,
        categoryId,
        source: "USER",
        confidence: 1,
        createdByUserId: session.userId,
      },
    });

    if (applyToFutureFromMerchant && transaction.normalizedMerchantId) {
      await tx.merchantRule.upsert({
        where: { householdId_merchantId: { householdId: session.householdId, merchantId: transaction.normalizedMerchantId } },
        update: { categoryId, createdById: session.userId },
        create: {
          householdId: session.householdId,
          merchantId: transaction.normalizedMerchantId,
          categoryId,
          createdById: session.userId,
        },
      });
    }
  });

  await recordAuditEvent({
    householdId: session.householdId,
    actorUserId: session.userId,
    action: applyToFutureFromMerchant ? "RECLASSIFY_TRANSACTION_AND_CREATE_RULE" : "RECLASSIFY_TRANSACTION",
    entityType: "Transaction",
    entityId: transactionId,
    metadata: { categoryId },
  });

  revalidatePath(`/transactions/${transactionId}`);
  revalidatePath("/transactions");
  revalidatePath("/");
}

export async function setExcludedFromBudget(formData: FormData): Promise<void> {
  const session = await requireSession();
  const transactionId = String(formData.get("transactionId"));
  const excluded = formData.get("excluded") === "on";

  await prisma.transaction.updateMany({
    where: { id: transactionId, account: { connection: { householdId: session.householdId } } },
    data: { isExcludedFromBudget: excluded },
  });

  await recordAuditEvent({
    householdId: session.householdId,
    actorUserId: session.userId,
    action: excluded ? "EXCLUDE_TRANSACTION" : "INCLUDE_TRANSACTION",
    entityType: "Transaction",
    entityId: transactionId,
  });

  revalidatePath(`/transactions/${transactionId}`);
  revalidatePath("/transactions");
  revalidatePath("/");
}

export async function markAsTransfer(formData: FormData): Promise<void> {
  const session = await requireSession();
  const transactionId = String(formData.get("transactionId"));

  await prisma.transaction.updateMany({
    where: { id: transactionId, account: { connection: { householdId: session.householdId } } },
    data: { isTransfer: true, isExcludedFromBudget: true },
  });

  await recordAuditEvent({
    householdId: session.householdId,
    actorUserId: session.userId,
    action: "MARK_TRANSACTION_AS_TRANSFER",
    entityType: "Transaction",
    entityId: transactionId,
  });

  revalidatePath(`/transactions/${transactionId}`);
  revalidatePath("/transactions");
  revalidatePath("/");
}

export async function updateNotes(formData: FormData): Promise<void> {
  const session = await requireSession();
  const transactionId = String(formData.get("transactionId"));
  const notes = String(formData.get("notes") ?? "");

  await prisma.transaction.updateMany({
    where: { id: transactionId, account: { connection: { householdId: session.householdId } } },
    data: { notes: notes || null },
  });

  revalidatePath(`/transactions/${transactionId}`);
}
