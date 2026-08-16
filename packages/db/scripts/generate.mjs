// Wraps `prisma generate` so it runs even when the only connection string
// present is named something other than DATABASE_URL (see
// resolveDatabaseUrl.mjs) — prisma generate validates the schema's
// datasource block, which requires the env var it references to resolve.
import { execFileSync } from "node:child_process";
import { resolveDatabaseUrl } from "./resolveDatabaseUrl.mjs";

// Vercel injects env vars directly into process.env — no .env file exists
// there. Locally, load one if present so this script behaves the same way
// running here as it will in Vercel's build.
try {
  process.loadEnvFile();
} catch {
  // No local .env — fine, e.g. in Vercel's build environment.
}

const { url, source } = resolveDatabaseUrl();
console.log(`[prisma generate] using connection string from ${source}`);

execFileSync("prisma", ["generate"], {
  stdio: "inherit",
  env: { ...process.env, DATABASE_URL: url },
});
