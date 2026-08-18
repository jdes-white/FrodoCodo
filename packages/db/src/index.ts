import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
// Must run before "@prisma/client" is imported — it patches the fs.readFileSync
// call the client uses to load its WASM query compiler, so that call
// returns bytes embedded directly in the JS bundle instead of depending on
// Vercel having correctly included the real file. See
// packages/db/src/wasmCompilerPatch.ts for the full history of why this
// exists (three prior attempts to get Vercel's output-file tracer to
// include that file all failed in production despite passing every local
// check) and docs/deployment.md for how it's verified.
import "./wasmCompilerPatch.js";
// Deliberately the plain "@prisma/client" import, NOT "@prisma/client/wasm".
// The /wasm entry point is built for edge/worker runtimes with native
// ESM-WebAssembly import support and was tried first here — it loads its
// query compiler via `import('./query_compiler_bg.wasm')`, which sounded
// like a cleaner, more bundler-friendly path than a runtime file read. It
// wasn't: webpack's `asyncWebAssembly` handling (the only way Next.js
// bundles a Node.js server route touching a .wasm import) shapes that
// import differently from what Prisma's edge-oriented loader code expects,
// so every query failed at runtime with "The loaded wasm module was
// unexpectedly undefined or null" even though the build succeeded. The
// plain client's Node-condition loader does the same job via a regular
// fs.readFileSync of query_compiler_bg.wasm — intercepted by the patch
// above rather than left to Vercel's tracer.
import { PrismaClient } from "@prisma/client";
import { logDbEvent, logDbError } from "./dbErrors.js";

declare global {
  // eslint-disable-next-line no-var
  var __frodocodoPrisma: PrismaClient | undefined;
  // eslint-disable-next-line no-var
  var __frodocodoPgPool: Pool | undefined;
}

/**
 * Neon's Vercel integration doesn't always name the connection string
 * DATABASE_URL — depending on how the database was provisioned it can also
 * be POSTGRES_PRISMA_URL / POSTGRES_URL (pooled) or DATABASE_URL_UNPOOLED /
 * POSTGRES_URL_NON_POOLING (direct). The runtime app wants the pooled one.
 * Mirrors packages/db/scripts/resolveDatabaseUrl.mjs — kept as a separate
 * small copy since that one runs via plain `node` at build time, before
 * this package's TS/ESM tooling is available. See docs/deployment.md.
 */
function resolveDatabaseUrl(): string {
  const candidates = ["DATABASE_URL", "POSTGRES_PRISMA_URL", "POSTGRES_URL", "DATABASE_URL_UNPOOLED", "POSTGRES_URL_NON_POOLING"];
  for (const name of candidates) {
    const value = process.env[name];
    if (value) {
      // Log which env var resolved, never its value — confirms at a glance
      // whether env-var resolution silently picked an unexpected candidate,
      // without ever printing a connection string.
      logDbEvent("connection_string_resolved", { source: name });
      return value;
    }
  }
  throw new Error(
    `No database connection string found. Checked: ${candidates.join(", ")}. ` +
      "Set DATABASE_URL, or attach a Postgres integration that does.",
  );
}

/**
 * Driver-adapter mode (see the `engineType = "client"` generator setting in
 * packages/db/prisma/schema.prisma): Prisma Client has no built-in engine of
 * its own here — it hands every query to the `pg` driver via this adapter
 * instead of shelling out to a bundled native/WASM query engine that talks
 * to Postgres on its own. This is what removes the dependency on shipping a
 * platform-specific `libquery_engine-*.so.node` binary inside a Vercel
 * Lambda — see docs/deployment.md for the history of why that kept failing.
 */
function createPrismaClient(): PrismaClient {
  let pool = globalThis.__frodocodoPgPool;
  if (!pool) {
    pool = new Pool({
      connectionString: resolveDatabaseUrl(),
      // Neon's pooled endpoint already pools connections server-side via
      // PgBouncer — this Pool just needs to avoid multiplying that further
      // across concurrent serverless invocations, not provide its own large
      // pool. Kept small and conservative rather than left at pg's default
      // (10), which is sized for a single long-lived server process, not a
      // Lambda instance.
      max: 3,
    });
    logDbEvent("pool_created", { max: 3 });
    // node-postgres requires an `error` listener on the Pool: if a pooled
    // (idle) client hits a network-level error — which cloud Postgres
    // proxies like Neon's routinely trigger by closing idle connections —
    // and nothing is listening, Node's default EventEmitter behavior is to
    // throw and crash the entire process. Local Postgres essentially never
    // does this (no aggressive idle-connection reaping), so this was
    // invisible in every local/isolated test run and only surfaced as an
    // unexplained "server-side exception" against the real Neon connection
    // in production — see docs/deployment.md.
    pool.on("error", (err) => {
      logDbError("pool_idle_client_error", err);
    });
  }
  const client = new PrismaClient({ adapter: new PrismaPg(pool) });
  if (process.env.NODE_ENV !== "production") {
    // Dev hot-reload re-evaluates this module on every edit — cache the pool
    // too, not just the client, so each reload doesn't leak a new pg.Pool.
    globalThis.__frodocodoPgPool = pool;
  }
  return client;
}

export const prisma = globalThis.__frodocodoPrisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.__frodocodoPrisma = prisma;
}

export * from "@prisma/client";
export { seedDemoHousehold, type SeedResult } from "./seedHousehold.js";
export { sanitizeDbError, logDbEvent, logDbError, type SanitizedDbError } from "./dbErrors.js";
