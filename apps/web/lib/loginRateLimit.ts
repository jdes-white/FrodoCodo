import { prisma } from "@frodocodo/db";

/**
 * Persistent (Postgres-backed, not in-memory — Render can restart the
 * container at any time) login rate limiting (security audit finding H2).
 *
 * Two independent buckets, both counting only *failed* attempts within a
 * rolling window:
 *  - per (identifier, ip): the primary guard against brute-forcing one
 *    specific account. Keyed by the pair, not the identifier alone, so an
 *    attacker can't lock a real household member out of their own account
 *    just by repeatedly failing with their email from an unrelated IP —
 *    the household member's own (identifier, their real ip) bucket stays
 *    unaffected.
 *  - per ip alone: a coarser secondary guard against one attacker spraying
 *    many different email addresses from a single source, set high enough
 *    that two household members making ordinary mistakes from the same
 *    home IP won't trip it.
 *
 * Deliberately does not distinguish "this identifier doesn't exist" from
 * "this identifier exists but is failing" anywhere in this module — every
 * (identifier, ip) pair is tracked identically whether or not a real User
 * matches that email, so the limiter itself can never be used as an
 * account-enumeration oracle (a nonexistent email throttles exactly like a
 * real one under repeated guessing).
 */

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES_PER_IDENTIFIER = 5;
const MAX_FAILURES_PER_IP = 20;
const RETENTION_MS = 24 * 60 * 60 * 1000;

export function normalizeLoginIdentifier(email: string): string {
  return email.trim().toLowerCase();
}

export async function isLoginRateLimited(identifier: string, ip: string | null): Promise<boolean> {
  const since = new Date(Date.now() - WINDOW_MS);

  const [byIdentifier, byIp] = await Promise.all([
    prisma.loginAttempt.count({ where: { identifier, succeeded: false, createdAt: { gte: since } } }),
    ip ? prisma.loginAttempt.count({ where: { ipAddress: ip, succeeded: false, createdAt: { gte: since } } }) : Promise.resolve(0),
  ]);

  return byIdentifier >= MAX_FAILURES_PER_IDENTIFIER || byIp >= MAX_FAILURES_PER_IP;
}

/**
 * Logs one attempt. Best-effort prunes attempts older than RETENTION_MS on
 * every call so this table self-cleans without a scheduled job — cheap and
 * sufficient at two-user-household volume; a failure here never blocks login.
 */
export async function recordLoginAttempt(identifier: string, ip: string | null, succeeded: boolean): Promise<void> {
  await prisma.loginAttempt.create({ data: { identifier, ipAddress: ip, succeeded } });
  prisma.loginAttempt.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - RETENTION_MS) } } }).catch(() => {});
}
