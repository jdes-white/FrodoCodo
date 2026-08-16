// Plain-JS (not TS) because this is imported by build-time scripts that run
// via a bare `node`, before this repo's TS/ESM tooling is available.
//
// Neon's Vercel integration doesn't always name the connection string
// DATABASE_URL — depending on how the database was provisioned it can also
// be POSTGRES_PRISMA_URL / POSTGRES_URL (pooled, via pgbouncer) or
// DATABASE_URL_UNPOOLED / POSTGRES_URL_NON_POOLING (direct). Rather than
// assume one, check every plausible name. See docs/deployment.md.
const POOLED_CANDIDATES = ["DATABASE_URL", "POSTGRES_PRISMA_URL", "POSTGRES_URL"];
const DIRECT_CANDIDATES = ["DATABASE_URL_UNPOOLED", "POSTGRES_URL_NON_POOLING", ...POOLED_CANDIDATES];

/**
 * @param {{ preferDirect?: boolean }} [options] preferDirect: true prefers a
 *   non-pooled connection — Prisma's migration engine needs a direct
 *   connection (advisory locks don't work reliably through pgbouncer's
 *   transaction pooling mode). Runtime queries should use the pooled one.
 * @returns {{ url: string, source: string }}
 */
export function resolveDatabaseUrl(options = {}) {
  const candidates = options.preferDirect ? DIRECT_CANDIDATES : POOLED_CANDIDATES;
  for (const name of candidates) {
    const value = process.env[name];
    if (value) return { url: value, source: name };
  }
  throw new Error(
    `No database connection string found. Checked: ${candidates.join(", ")}. ` +
      "Make sure a Postgres integration (e.g. Neon) is attached to this Vercel project.",
  );
}
