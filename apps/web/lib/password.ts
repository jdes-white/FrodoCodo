import bcrypt from "bcryptjs";

const SALT_ROUNDS = 12;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/**
 * A bcrypt hash of an arbitrary, unused value — not a real password for any
 * account. Computed once per process (bcrypt is deliberately slow; doing
 * this per-request would be wasteful) so login/actions.ts can run a real
 * bcrypt.compare() even when no user matches the submitted email, keeping
 * the two cases (no such user / wrong password) closer in timing than an
 * early return would. This never gates access to anything — it exists
 * purely so a login attempt's response time doesn't reveal whether the
 * submitted email belongs to a real account (security audit finding H2).
 */
export const DUMMY_PASSWORD_HASH = bcrypt.hashSync(`frodocodo-timing-safety-placeholder-${SALT_ROUNDS}`, SALT_ROUNDS);
