-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "suggestedCategoryConfidence" DOUBLE PRECISION,
ADD COLUMN     "suggestedCategoryId" TEXT,
ADD COLUMN     "suggestedCategorySource" "ClassificationSource";

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_suggestedCategoryId_fkey" FOREIGN KEY ("suggestedCategoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;
