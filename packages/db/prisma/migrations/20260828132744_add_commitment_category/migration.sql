-- AlterTable
ALTER TABLE "UpcomingCommitment" ADD COLUMN     "categoryId" TEXT;

-- CreateIndex
CREATE INDEX "UpcomingCommitment_categoryId_idx" ON "UpcomingCommitment"("categoryId");

-- AddForeignKey
ALTER TABLE "UpcomingCommitment" ADD CONSTRAINT "UpcomingCommitment_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;
