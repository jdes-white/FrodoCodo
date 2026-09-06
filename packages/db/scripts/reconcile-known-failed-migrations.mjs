#!/usr/bin/env node
// One-time, narrowly-scoped reconciliation for a specific historical
// incident, run automatically as a pre-step before `prisma migrate deploy`
// in apps/web/scripts/start.sh.
//
// Before automatic migrations existed, `20260822113229_add_north_star_assumptions`
// shipped without ever being applied via `prisma migrate deploy` against
// production, so it crashed North Star with P2021 ("table does not
// exist"). That was patched with a targeted self-heal —
// apps/web/lib/northStar.ts's ensureNorthStarTable(), now-obsolete —
// which created the NorthStarAssumptions table/index/constraint out of
// band, via idempotent raw SQL over the app's own pooled connection, the
// first time North Star was accessed. The table has therefore existed in
// production for a while, but `_prisma_migrations` had no record of that
// migration ever running.
//
// When automatic migrations first ran (this session's earlier fix), Prisma
// tried to apply that migration for real, hit Postgres error 42P07
// ("relation already exists") because the self-heal had already created
// it, and recorded the migration as FAILED. Every subsequent
// `migrate deploy` since has refused outright with P3009 ("found failed
// migrations in the target database, new migrations will not be
// applied") — including blocking genuinely new, unrelated migrations
// (e.g. Upcoming Commitments) from ever being reached.
//
// This script does NOT blindly mark that migration applied. It only does
// so after verifying, against the real database schema, that every
// column/index/constraint the migration would have created already
// exists with the expected shape — i.e. that the self-heal really did
// produce an equivalent result. If that verification fails for any
// reason, this script exits non-zero and changes nothing, so start.sh's
// `set -e` still blocks the release exactly as it would for any other
// genuine migration problem — never silently paper over a real schema
// mismatch.
//
// `prisma migrate resolve --applied <name>` (the command this script
// shells out to once verified) is Prisma's own documented, production-safe
// mechanism for exactly this situation: a migration whose target schema
// already exists. It only updates `_prisma_migrations` bookkeeping —
// it does not run the migration's SQL, so it can never touch existing
// data.
//
// Safe to run on every container start: if the migration isn't currently
// in a failed state (never failed, or already resolved by a prior run),
// this is a silent no-op.
import { PrismaClient } from "@prisma/client";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const MIGRATION_NAME = "20260822113229_add_north_star_assumptions";

// Exact column set from
// packages/db/prisma/migrations/20260822113229_add_north_star_assumptions/migration.sql
const EXPECTED_COLUMNS = [
  "id",
  "householdId",
  "lifestyleTarget",
  "employmentIncome",
  "investedAssetsToday",
  "incomeProducingPortion",
  "cashYield",
  "capitalGrowthAssumption",
  "reinvestInvestmentIncome",
  "plannedAnnualContribution",
  "sideBusinessIncome",
  "otherPassiveIncome",
  "timeHorizonYears",
  "targetEmploymentDependency",
  "createdAt",
  "updatedAt",
];

function log(event, fields = {}) {
  console.log(JSON.stringify({ scope: "db", event, ...fields }));
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const packageDbDir = path.resolve(scriptDir, "..");
const schemaPath = path.join(packageDbDir, "prisma", "schema.prisma");
const prismaBinary = path.join(packageDbDir, "node_modules", ".bin", "prisma");

const prisma = new PrismaClient();

try {
  const failedRecords = await prisma.$queryRawUnsafe(
    `SELECT migration_name FROM "_prisma_migrations" WHERE migration_name = $1 AND finished_at IS NULL AND rolled_back_at IS NULL`,
    MIGRATION_NAME,
  );

  if (failedRecords.length === 0) {
    log("migration_reconcile_skip", { migration: MIGRATION_NAME, reason: "no_failed_record" });
    process.exit(0);
  }

  log("migration_reconcile_checking", { migration: MIGRATION_NAME });

  const columnRows = await prisma.$queryRawUnsafe(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'NorthStarAssumptions'`,
  );
  const actualColumns = new Set(columnRows.map((row) => row.column_name));
  const missingColumns = EXPECTED_COLUMNS.filter((column) => !actualColumns.has(column));

  const [{ has_pkey }] = await prisma.$queryRawUnsafe(
    `SELECT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'NorthStarAssumptions_pkey') AS has_pkey`,
  );
  const [{ has_unique_index }] = await prisma.$queryRawUnsafe(
    `SELECT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'NorthStarAssumptions_householdId_key') AS has_unique_index`,
  );
  const [{ has_fkey }] = await prisma.$queryRawUnsafe(
    `SELECT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'NorthStarAssumptions_householdId_fkey') AS has_fkey`,
  );

  if (missingColumns.length > 0 || !has_pkey || !has_unique_index || !has_fkey) {
    log("migration_reconcile_abort", {
      migration: MIGRATION_NAME,
      reason: "schema_does_not_match_expected_migration_output",
      missingColumns: missingColumns.join(",") || "(none)",
      has_pkey,
      has_unique_index,
      has_fkey,
    });
    console.error(
      `[reconcile] "${MIGRATION_NAME}" is recorded as failed, but the existing "NorthStarAssumptions" table does not fully ` +
        "match what that migration would create — refusing to mark it applied automatically. This needs manual investigation, " +
        "not an automatic resolution.",
    );
    process.exit(1);
  }

  log("migration_reconcile_verified", { migration: MIGRATION_NAME });
} finally {
  await prisma.$disconnect();
}

execFileSync(prismaBinary, ["migrate", "resolve", "--applied", MIGRATION_NAME, `--schema=${schemaPath}`], {
  stdio: "inherit",
});
log("migration_reconcile_resolved", { migration: MIGRATION_NAME });
