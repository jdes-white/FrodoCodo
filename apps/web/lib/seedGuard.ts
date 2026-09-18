/**
 * Whether the destructive demo-seed pipeline (packages/db/src/seedHousehold.ts,
 * which wipes every existing household before repopulating one) is allowed
 * to run at all in this process. This is deliberately independent of
 * SEED_TOKEN — a leaked token must never be sufficient on its own to wipe a
 * production database (security audit finding C2). No environment variable
 * can re-enable this in production; the only way to seed a production-like
 * environment is to run it with NODE_ENV unset to "production".
 */
export function isSeedingAllowed(nodeEnv: string | undefined): boolean {
  return nodeEnv !== "production";
}
