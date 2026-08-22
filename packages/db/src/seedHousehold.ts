/**
 * Populates a demo household using the MockProvider's synthetic dataset,
 * run through the real normalization/classification/transfer/refund
 * pipeline from @frodocodo/ledger — not a hand-authored fixture.
 *
 * Shared by two entry points: the CLI (`packages/db/prisma/seed.ts`, for
 * local dev) and the beta deployment's one-time seed API route
 * (`apps/web/app/api/admin/seed/route.ts`) — kept as a single importable
 * function so both stay in sync rather than duplicating this logic.
 *
 * Never run against a database containing real household data — it wipes
 * existing households first (§55: this repo never holds real financial data).
 */
import { randomUUID } from "node:crypto";
import bcryptjs from "bcryptjs";
import { MockProvider, MOCK_INSTITUTIONS } from "@frodocodo/providers";
import { normalizeMerchant, detectTransferPairs, detectRefunds } from "@frodocodo/ledger";
import { todayUTC } from "@frodocodo/shared";
import type { Prisma } from "@prisma/client";
import { prisma } from "./index.js";

const DEMO_ADMIN_EMAIL = "admin@frodocodo.household";
const DEMO_MEMBER_EMAIL = "member@frodocodo.household";
const DEMO_PASSWORD = "frodocodo-demo";

interface CategoryDef {
  key: string;
  name: string;
  bucketKey: string;
  spendingType: "FIXED_COMMITMENT" | "FLEXIBLE" | "SAVINGS";
  allocation: number;
  fixedDueDayOfMonth?: number;
}

const BUCKETS = [
  { key: "essentials", name: "Essentials", sortOrder: 0, colorToken: "essentials" },
  { key: "lifestyle", name: "Lifestyle & Discretionary", sortOrder: 1, colorToken: "lifestyle" },
  { key: "family", name: "Family & Household", sortOrder: 2, colorToken: "family" },
  { key: "savings", name: "Savings & Goals", sortOrder: 3, colorToken: "savings" },
];

const CATEGORIES: CategoryDef[] = [
  { key: "housing", name: "Mortgage / Housing", bucketKey: "essentials", spendingType: "FIXED_COMMITMENT", allocation: 2400, fixedDueDayOfMonth: 3 },
  { key: "insurance", name: "Insurance", bucketKey: "essentials", spendingType: "FIXED_COMMITMENT", allocation: 130, fixedDueDayOfMonth: 12 },
  { key: "utilities", name: "Utilities", bucketKey: "essentials", spendingType: "FIXED_COMMITMENT", allocation: 320, fixedDueDayOfMonth: 22 },
  { key: "groceries", name: "Groceries", bucketKey: "essentials", spendingType: "FLEXIBLE", allocation: 900 },
  { key: "fuel", name: "Fuel", bucketKey: "essentials", spendingType: "FLEXIBLE", allocation: 450 },
  { key: "dining", name: "Dining & Takeaway", bucketKey: "lifestyle", spendingType: "FLEXIBLE", allocation: 400 },
  { key: "shopping", name: "Shopping", bucketKey: "lifestyle", spendingType: "FLEXIBLE", allocation: 350 },
  { key: "subscriptions", name: "Subscriptions", bucketKey: "lifestyle", spendingType: "FIXED_COMMITMENT", allocation: 50, fixedDueDayOfMonth: 5 },
  { key: "family_household", name: "Family & Household", bucketKey: "family", spendingType: "FLEXIBLE", allocation: 250 },
  { key: "savings", name: "Savings", bucketKey: "savings", spendingType: "SAVINGS", allocation: 600 },
];

const CATEGORY_RULES: Array<{ pattern: RegExp; categoryKey: string }> = [
  { pattern: /NETFLIX|SPOTIFY|AMAZON PRIME/i, categoryKey: "subscriptions" },
  { pattern: /WOOLWORTHS|COLES(?! EXPRESS)|ALDI/i, categoryKey: "groceries" },
  { pattern: /\bBP\b|SHELL|7-ELEVEN/i, categoryKey: "fuel" },
  { pattern: /UBER EATS|MENULOG|MCDONALD|CORNER CAFE|RAMEN HOUSE/i, categoryKey: "dining" },
  { pattern: /KMART|TARGET|AMAZON AU\b|JB HI-FI/i, categoryKey: "shopping" },
  { pattern: /HOME LOAN/i, categoryKey: "housing" },
  { pattern: /AAMI|INSURANCE/i, categoryKey: "insurance" },
  { pattern: /ORIGIN ENERGY|TELSTRA/i, categoryKey: "utilities" },
];

function categorizeByDescription(description: string): string | null {
  for (const rule of CATEGORY_RULES) {
    if (rule.pattern.test(description)) return rule.categoryKey;
  }
  return null;
}

export interface SeedResult {
  householdId: string;
  transactionCount: number;
  adminEmail: string;
  memberEmail: string;
  password: string;
}

export async function seedDemoHousehold(log: (msg: string) => void = () => {}): Promise<SeedResult> {
  log("Wiping existing demo households...");
  await prisma.household.deleteMany({});
  await prisma.user.deleteMany({ where: { email: { in: [DEMO_ADMIN_EMAIL, DEMO_MEMBER_EMAIL] } } });

  log("Creating institutions...");
  const institutionByProviderId = new Map<string, { id: string }>();
  for (const inst of MOCK_INSTITUTIONS) {
    const row = await prisma.financialInstitution.upsert({
      where: { providerName_providerInstitutionId: { providerName: "mock", providerInstitutionId: inst.providerInstitutionId } },
      update: {},
      create: {
        name: inst.name,
        shortName: inst.shortName,
        supportedConnectionMethod: inst.connectionMethod,
        providerInstitutionId: inst.providerInstitutionId,
        providerName: "mock",
      },
    });
    institutionByProviderId.set(inst.providerInstitutionId, row);
  }

  log("Creating household and users...");
  const household = await prisma.household.create({
    data: {
      name: "The Household",
      defaultBudgetPeriodType: "CALENDAR_MONTH",
      onboardingCompletedAt: new Date(),
    },
  });

  const passwordHash = await bcryptjs.hash(DEMO_PASSWORD, 12);
  const admin = await prisma.user.create({
    data: { email: DEMO_ADMIN_EMAIL, passwordHash, name: "Alex" },
  });
  const member = await prisma.user.create({
    data: { email: DEMO_MEMBER_EMAIL, passwordHash, name: "Sam" },
  });
  await prisma.householdMember.createMany({
    data: [
      { householdId: household.id, userId: admin.id, role: "ADMIN" },
      { householdId: household.id, userId: member.id, role: "MEMBER" },
    ],
  });

  log("Creating North Star assumptions...");
  // V1 starting assumptions exactly as specified — see
  // packages/domain/src/northStar.ts for what they drive. Not admin-gated
  // to edit later; this is just the seed starting point.
  await prisma.northStarAssumptions.create({
    data: {
      householdId: household.id,
      lifestyleTarget: 190000,
      employmentIncome: 220000,
      investedAssetsToday: 70000,
      incomeProducingPortion: 0.5,
      cashYield: 0.04,
      capitalGrowthAssumption: 0.055,
      reinvestInvestmentIncome: true,
      plannedAnnualContribution: 30000,
      sideBusinessIncome: 0,
      otherPassiveIncome: 0,
      timeHorizonYears: 10,
      targetEmploymentDependency: 0,
    },
  });

  log("Creating budget buckets and categories...");
  const bucketByKey = new Map<string, { id: string }>();
  for (const b of BUCKETS) {
    const row = await prisma.budgetBucket.create({
      data: { householdId: household.id, name: b.name, sortOrder: b.sortOrder, colorToken: b.colorToken },
    });
    bucketByKey.set(b.key, row);
  }

  const categoryByKey = new Map<string, { id: string; spendingType: string }>();
  for (const c of CATEGORIES) {
    const bucket = bucketByKey.get(c.bucketKey)!;
    const row = await prisma.category.create({
      data: { householdId: household.id, bucketId: bucket.id, name: c.name, spendingType: c.spendingType },
    });
    categoryByKey.set(c.key, row);

    if (c.spendingType === "FIXED_COMMITMENT" && c.fixedDueDayOfMonth) {
      await prisma.fixedCommitment.create({
        data: {
          householdId: household.id,
          categoryId: row.id,
          name: c.name,
          expectedAmount: c.allocation,
          expectedDueDayOfMonth: c.fixedDueDayOfMonth,
          frequency: "MONTHLY",
        },
      });
    }
  }

  log("Creating this period's budget allocations...");
  const asOf = todayUTC();
  const periodStart = `${asOf.slice(0, 7)}-01`;
  const periodEndDate = new Date(Date.UTC(Number(asOf.slice(0, 4)), Number(asOf.slice(5, 7)), 0));
  const periodEnd = periodEndDate.toISOString().slice(0, 10);

  const budgetPeriod = await prisma.budgetPeriod.create({
    data: {
      householdId: household.id,
      type: "CALENDAR_MONTH",
      startDate: new Date(periodStart),
      endDate: new Date(periodEnd),
      status: "ACTIVE",
      expectedIncome: 5900,
      bufferAmount: 200,
      allocations: {
        create: CATEGORIES.map((c) => ({ categoryId: categoryByKey.get(c.key)!.id, amount: c.allocation })),
      },
    },
  });
  log(`Budget period ${budgetPeriod.startDate.toISOString().slice(0, 10)} -> ${budgetPeriod.endDate.toISOString().slice(0, 10)}`);

  log("Connecting mock institutions and syncing transactions...");
  const provider = new MockProvider();

  // Neon's remote round-trip latency (unlike local Postgres) makes one DB
  // call per transaction/merchant needlessly slow — this stage batches
  // everything into a handful of bulk statements instead of ~450+
  // sequential creates/upserts. Provider calls stay per-institution (cheap,
  // in-memory, no I/O); only the DB writes are batched.
  interface RawSyncedTransaction {
    accountId: string;
    accountType: string;
    tx: Awaited<ReturnType<typeof provider.syncTransactions>>["transactions"][number];
  }
  const rawTransactions: RawSyncedTransaction[] = [];

  for (const inst of MOCK_INSTITUTIONS) {
    const institution = institutionByProviderId.get(inst.providerInstitutionId)!;
    const { providerConnectionId } = await provider.initiateConnection(inst.providerInstitutionId);
    const consent = await provider.getConsentStatus(providerConnectionId);

    const connection = await prisma.financialConnection.create({
      data: {
        householdId: household.id,
        institutionId: institution.id,
        providerName: "mock",
        providerConnectionId,
        connectionMethod: inst.connectionMethod,
        consentStatus: consent.status,
        consentGrantedAt: consent.grantedAt ? new Date(consent.grantedAt) : undefined,
        consentExpiresAt: consent.expiresAt ? new Date(consent.expiresAt) : undefined,
        lastSyncedAt: new Date(),
      },
    });

    const providerAccounts = await provider.discoverAccounts(providerConnectionId);
    // Generate ids up front so createMany's rows and this in-memory map
    // reference the exact same account — createMany doesn't return rows,
    // so there's nothing to read back from the DB afterward.
    const accountByProviderId = new Map<string, { id: string; accountType: string }>(
      providerAccounts.map((pa) => [pa.providerAccountId, { id: randomUUID(), accountType: pa.accountType }]),
    );
    await prisma.account.createMany({
      data: providerAccounts.map((pa) => ({
        id: accountByProviderId.get(pa.providerAccountId)!.id,
        connectionId: connection.id,
        providerAccountId: pa.providerAccountId,
        displayName: pa.displayName,
        accountType: pa.accountType,
        currency: pa.currency,
        currentBalance: pa.currentBalance.toNumber(),
        availableBalance: pa.availableBalance.toNumber(),
        lastSyncedAt: new Date(),
      })),
    });

    const sync = await provider.syncTransactions(providerConnectionId, {});
    for (const tx of sync.transactions) {
      const account = accountByProviderId.get(tx.accountProviderId)!;
      rawTransactions.push({ accountId: account.id, accountType: account.accountType, tx });
    }
  }

  log(`Preparing merchants and classifications for ${rawTransactions.length} transactions...`);
  const merchantByMatchKey = new Map<string, { normalizedName: string; matchKey: string; confidence: number }>();
  for (const { tx } of rawTransactions) {
    const merchant = normalizeMerchant(tx.description);
    if (!merchantByMatchKey.has(merchant.matchKey)) merchantByMatchKey.set(merchant.matchKey, merchant);
  }

  await prisma.merchant.createMany({
    data: [...merchantByMatchKey.values()].map((m) => ({
      householdId: household.id,
      normalizedName: m.normalizedName,
      matchKey: m.matchKey,
    })),
    skipDuplicates: true,
  });
  const merchantRows = await prisma.merchant.findMany({
    where: { householdId: household.id, matchKey: { in: [...merchantByMatchKey.keys()] } },
    select: { id: true, matchKey: true },
  });
  const merchantIdByMatchKey = new Map(merchantRows.map((m) => [m.matchKey, m.id]));

  interface StagedTransaction {
    id: string;
    accountId: string;
    accountType: string;
    merchantMatchKey: string | null;
    categoryId: string | null;
    data: Prisma.TransactionCreateManyInput;
  }
  const staged: StagedTransaction[] = rawTransactions.map(({ accountId, accountType, tx }) => {
    const merchant = normalizeMerchant(tx.description);
    const isIncome = /SALARY/i.test(tx.description);
    const isTransferLabel = /^PAYMENT (TO|RECEIVED)/i.test(tx.description);
    const categoryKey = isIncome || isTransferLabel ? null : categorizeByDescription(tx.description);
    const category = categoryKey ? categoryByKey.get(categoryKey)! : null;
    const id = randomUUID();

    return {
      id,
      accountId,
      accountType,
      merchantMatchKey: merchant.matchKey,
      categoryId: category?.id ?? null,
      data: {
        id,
        accountId,
        providerTransactionId: tx.providerTransactionId,
        transactionDate: new Date(tx.transactionDate),
        postingDate: tx.postingDate ? new Date(tx.postingDate) : null,
        amount: tx.amount.toNumber(),
        direction: tx.direction,
        status: tx.status,
        originalDescription: tx.description,
        normalizedMerchantId: merchantIdByMatchKey.get(merchant.matchKey) ?? null,
        merchantConfidence: merchant.confidence,
        categoryId: category?.id ?? null,
        classificationConfidence: category ? 1 : undefined,
        classificationSource: category ? "RULE" : undefined,
        isExcludedFromBudget: isIncome || isTransferLabel,
        isTransfer: isTransferLabel,
        rawProviderPayload: tx.raw as never,
      },
    };
  });

  log(`Inserting ${staged.length} transactions...`);
  await prisma.transaction.createMany({ data: staged.map((t) => t.data) });

  const classified = staged.filter((t) => t.categoryId);
  if (classified.length > 0) {
    await prisma.transactionClassification.createMany({
      data: classified.map((t) => ({ transactionId: t.id, categoryId: t.categoryId!, source: "RULE" as const, confidence: 1 })),
    });
  }

  log("Reconciling transfers and refunds via @frodocodo/ledger...");
  const transferMatches = detectTransferPairs(
    staged
      .filter((t) => t.data.isTransfer)
      .map((t) => ({
        id: t.id,
        accountId: t.accountId,
        accountType: t.accountType as never,
        amount: (t.data as { amount: number }).amount,
        direction: (t.data as { direction: "DEBIT" | "CREDIT" }).direction,
        transactionDate: (t.data as { transactionDate: Date }).transactionDate.toISOString().slice(0, 10),
      })),
  );

  const refundCandidates = staged
    .filter((t) => t.merchantMatchKey)
    .map((t) => ({
      id: t.id,
      accountId: t.accountId,
      merchantMatchKey: t.merchantMatchKey,
      amount: (t.data as { amount: number }).amount,
      direction: (t.data as { direction: "DEBIT" | "CREDIT" }).direction,
      transactionDate: (t.data as { transactionDate: Date }).transactionDate.toISOString().slice(0, 10),
    }));
  const refundMatches = detectRefunds(refundCandidates);

  // Each row needs different data, so these can't collapse into a single
  // createMany/updateMany — but batching them as one Prisma transaction
  // pipelines every statement over the same connection in one round trip
  // to the database instead of one per update.
  const updates = [
    ...transferMatches.flatMap((match) => [
      prisma.transaction.update({
        where: { id: match.debitTransactionId },
        data: { transferGroupId: match.debitTransactionId, counterpartTransactionId: match.creditTransactionId },
      }),
      prisma.transaction.update({
        where: { id: match.creditTransactionId },
        data: { transferGroupId: match.debitTransactionId },
      }),
    ]),
    ...refundMatches.map((match) => {
      const original = staged.find((t) => t.id === match.originalTransactionId)!;
      return prisma.transaction.update({
        where: { id: match.refundTransactionId },
        data: { refundOfTransactionId: match.originalTransactionId, categoryId: original.categoryId },
      });
    }),
  ];
  if (updates.length > 0) await prisma.$transaction(updates);

  log("Done.");

  return {
    householdId: household.id,
    transactionCount: staged.length,
    adminEmail: DEMO_ADMIN_EMAIL,
    memberEmail: DEMO_MEMBER_EMAIL,
    password: DEMO_PASSWORD,
  };
}
