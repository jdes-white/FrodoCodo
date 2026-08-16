// Wraps `prisma migrate deploy` + `next build` so migrations run even when
// the only connection string Vercel injected is named something other than
// DATABASE_URL (see packages/db/scripts/resolveDatabaseUrl.mjs). Prefers a
// direct/unpooled connection for the migration step specifically — Prisma's
// migration engine needs one (advisory locks don't work reliably through
// pgbouncer's transaction pooling mode), whereas the app's runtime queries
// are fine with (and better served by) a pooled connection.
import { execFileSync } from "node:child_process";
import { resolveDatabaseUrl } from "../../../packages/db/scripts/resolveDatabaseUrl.mjs";

// Vercel injects env vars directly into process.env — no .env file exists
// there. Locally, load one if present so this script behaves the same way
// running here as it will in Vercel's build.
try {
  process.loadEnvFile();
} catch {
  // No local .env — fine, e.g. in Vercel's build environment.
}

const { url, source } = resolveDatabaseUrl({ preferDirect: true });
console.log(`[vercel-build] running migrations using connection string from ${source} (direct/unpooled preferred)`);

const env = { ...process.env, DATABASE_URL: url };

execFileSync("prisma", ["migrate", "deploy", "--schema=../../packages/db/prisma/schema.prisma"], {
  stdio: "inherit",
  env,
});

execFileSync("next", ["build"], { stdio: "inherit", env });
