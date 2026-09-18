import { NextResponse } from "next/server";

/**
 * Plain liveness check — no database access. This is what Render's
 * platform-level health check (render.yaml's healthCheckPath) should point
 * at: it answers "is the Node process up and serving requests," which is
 * the question a platform-level health check actually needs answered.
 *
 * GET /api/health/db (a sibling route) answers a different question — "can
 * the app actually reach the database right now" — and is deliberately
 * kept separate. If a transient Neon blip made /api/health/db fail
 * temporarily and Render's health check pointed at it, Render could decide
 * the whole service is unhealthy and restart it, which doesn't fix a
 * database-side problem and just adds a cold start on top of it. Use
 * /api/health/db for manual/application-level verification instead.
 */
export function GET(): NextResponse {
  return NextResponse.json({ ok: true });
}
