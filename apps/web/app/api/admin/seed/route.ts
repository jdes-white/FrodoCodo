import { NextResponse } from "next/server";
import { seedDemoHousehold } from "@frodocodo/db";

// Seeding does ~150+ sequential DB round-trips — longer than the platform's
// default function timeout. Vercel caps this to whatever the plan allows
// (e.g. Hobby's ceiling) if 60 is higher than permitted, so it's safe to
// declare even without knowing the exact plan limit.
export const maxDuration = 60;

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
 * anyone who merely finds the URL. There is no real household data behind
 * it yet, but the same protection stays in place regardless.
 */
export async function POST(request: Request): Promise<NextResponse> {
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
