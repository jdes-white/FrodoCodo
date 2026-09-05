-- CreateEnum
CREATE TYPE "CommitmentRecurrence" AS ENUM ('WEEKLY', 'FORTNIGHTLY', 'MONTHLY');

-- CreateTable
CREATE TABLE "UpcomingCommitment" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "expectedDate" DATE NOT NULL,
    "recurrence" "CommitmentRecurrence",
    "completedAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UpcomingCommitment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UpcomingCommitment_householdId_expectedDate_idx" ON "UpcomingCommitment"("householdId", "expectedDate");

-- AddForeignKey
ALTER TABLE "UpcomingCommitment" ADD CONSTRAINT "UpcomingCommitment_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UpcomingCommitment" ADD CONSTRAINT "UpcomingCommitment_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
