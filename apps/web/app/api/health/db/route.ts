import { NextResponse } from "next/server";
import { prisma, logDbEvent, logDbError } from "@frodocodo/db";

/**
 * Temporary production diagnostic endpoint: runs one trivial query
 * (`SELECT 1`) through the exact same `prisma` singleton and `pg.Pool` the
 * rest of the app uses (see `packages/db/src/index.ts`) — not a separate
 * connection or code path — so a healthy response here means the database
 * module itself is reachable and working end-to-end, and a failure here
 * (rather than only on /login) narrows the problem to the DB layer instead
 * of something login-specific (session signing, password hashing, etc.).
 *
 * Deliberately unauthenticated (a health check gated behind a login you're
 * trying to debug isn't useful) but the response is scoped tightly: on
 * failure it returns only an error class, a Prisma/Postgres error code if
 * one is present, and a redacted, length-capped message — never a
 * connection string, credential, or full stack trace. See
 * packages/db/src/dbErrors.ts for the sanitizer shared with the login path.
 *
 * Remove this once the current production DB connectivity issue is
 * resolved and confirmed stable — it's diagnostic scaffolding, not a
 * permanent part of the product surface.
 */
export async function GET(): Promise<NextResponse> {
  const startedAt = Date.now();
  logDbEvent("health_check_started");

  try {
    await prisma.$queryRaw`SELECT 1`;
    logDbEvent("health_check_succeeded", { durationMs: Date.now() - startedAt });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const sanitized = logDbError("health_check_failed", error, { durationMs: Date.now() - startedAt });
    return NextResponse.json({ ok: false, ...sanitized }, { status: 503 });
  }
}
