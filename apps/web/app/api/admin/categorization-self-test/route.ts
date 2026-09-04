import { NextResponse } from "next/server";
import { runCategorizationSelfTest } from "@/lib/categorizationSelfTest";

/**
 * TEMPORARY manual fallback — see `@/lib/categorizationSelfTest`'s doc
 * comment. The primary trigger is `apps/web/instrumentation.ts` (runs
 * automatically on server boot); this route exists in case a re-run is
 * needed without a redeploy. Gated by `DIAGNOSTIC_TOKEN`, distinct from
 * `SEED_TOKEN`.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const token = request.headers.get("x-diagnostic-token") ?? new URL(request.url).searchParams.get("token");
  const expected = process.env.DIAGNOSTIC_TOKEN;
  if (!expected) {
    return NextResponse.json({ error: "DIAGNOSTIC_TOKEN is not configured on the server" }, { status: 500 });
  }
  if (token !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await runCategorizationSelfTest();
  return NextResponse.json(result);
}
