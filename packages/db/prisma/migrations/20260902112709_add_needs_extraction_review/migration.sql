-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "needsExtractionReview" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "Transaction_needsExtractionReview_idx" ON "Transaction"("needsExtractionReview");
