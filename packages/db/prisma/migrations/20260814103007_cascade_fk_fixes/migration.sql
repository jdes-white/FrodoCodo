-- DropForeignKey
ALTER TABLE "BudgetAllocation" DROP CONSTRAINT "BudgetAllocation_categoryId_fkey";

-- DropForeignKey
ALTER TABLE "Category" DROP CONSTRAINT "Category_bucketId_fkey";

-- DropForeignKey
ALTER TABLE "FixedCommitment" DROP CONSTRAINT "FixedCommitment_categoryId_fkey";

-- DropForeignKey
ALTER TABLE "MerchantRule" DROP CONSTRAINT "MerchantRule_categoryId_fkey";

-- DropForeignKey
ALTER TABLE "TransactionClassification" DROP CONSTRAINT "TransactionClassification_categoryId_fkey";

-- AddForeignKey
ALTER TABLE "MerchantRule" ADD CONSTRAINT "MerchantRule_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_bucketId_fkey" FOREIGN KEY ("bucketId") REFERENCES "BudgetBucket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetAllocation" ADD CONSTRAINT "BudgetAllocation_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FixedCommitment" ADD CONSTRAINT "FixedCommitment_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionClassification" ADD CONSTRAINT "TransactionClassification_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;
