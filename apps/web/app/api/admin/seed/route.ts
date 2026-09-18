import { NextResponse } from "next/server";
import { seedDemoHousehold } from "@frodocodo/db";
import { isSeedingAllowed } from "@/lib/seedGuard";

/**
 * One-time (or reset-on-demand) trigger for populating the beta deployment
 * with synthetic demo data — the same MockProvider -> ledger pipeline the
 * local seed script runs (see packages/db/src/seedHousehold.ts).
 *
 * Deliberately NOT wired into the build/deploy step: unlike `prisma migrate
 * deploy` (safe to re-run every deploy), seeding WIPES existing households
 * first, so it must only run when explicitly triggered — otherwise every
 * code push would erase real usage data.
 *
 * Protected by SEED_TOKEN (a low-sensitivity operational secret, distinct
 * from the database credentials) so this endpoint can't be triggered by
 * anyone who merely finds the URL — but a leaked token must never be
 * sufficient on its own to wipe a production database (security audit
 * finding C2), so production is blocked unconditionally below, before the
 * token is even checked. There is no environment variable that re-enables
 * this in production; the only way to seed a production-like deployment
 * is to run it with NODE_ENV unset to "production" (see lib/seedGuard.ts).
 */
export async function POST(request: Request): Promise<NextResponse> {
  if (!isSeedingAllowed(process.env.NODE_ENV)) {
    return NextResponse.json(
      { error: "Demo seeding is disabled in production. This endpoint only runs in non-production environments." },
      { status: 403 },
    );
  }

  const token = request.headers.get("x-seed-token") ?? new URL(request.url).searchParams.get("token");
  const expected = process.env.SEED_TOKEN;

  if (!expected) {
    return NextResponse.json({ error: "SEED_TOKEN is not configured on the server" }, { status: 500 });
  }
  if (token !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const logs: string[] = [];
  try {
    const result = await seedDemoHousehold((msg) => logs.push(msg));
    return NextResponse.json({ ok: true, result, logs });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err), logs }, { status: 500 });
  }
}
