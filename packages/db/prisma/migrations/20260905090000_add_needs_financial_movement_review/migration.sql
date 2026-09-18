-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "needsFinancialMovementReview" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "Transaction_needsFinancialMovementReview_idx" ON "Transaction"("needsFinancialMovementReview");
