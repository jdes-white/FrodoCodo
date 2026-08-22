-- CreateTable
CREATE TABLE "NorthStarAssumptions" (
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

-- CreateIndex
CREATE UNIQUE INDEX "NorthStarAssumptions_householdId_key" ON "NorthStarAssumptions"("householdId");

-- AddForeignKey
ALTER TABLE "NorthStarAssumptions" ADD CONSTRAINT "NorthStarAssumptions_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;
