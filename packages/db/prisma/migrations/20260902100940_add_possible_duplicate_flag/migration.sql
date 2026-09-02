-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "possibleDuplicateOfId" TEXT;

-- CreateIndex
CREATE INDEX "Transaction_possibleDuplicateOfId_idx" ON "Transaction"("possibleDuplicateOfId");

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_possibleDuplicateOfId_fkey" FOREIGN KEY ("possibleDuplicateOfId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
