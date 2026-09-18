"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { prisma, logDbError } from "@frodocodo/db";
import { verifyPassword, DUMMY_PASSWORD_HASH } from "@/lib/password";
import { createSession } from "@/lib/session";
import { normalizeLoginIdentifier, isLoginRateLimited, recordLoginAttempt } from "@/lib/loginRateLimit";

export interface LoginState {
  error?: string;
}

/**
 * Not caught to change behavior — an unhandled rejection here still hits
 * Next.js's generic error boundary exactly as before this existed. Caught
 * only so a real DB-layer failure is logged with safe, attributable detail
 * (see packages/db/src/dbErrors.ts) instead of only ever showing up to us
 * as an opaque "server-side exception" digest — then rethrown unchanged.
 */
async function findUserForLogin(email: string) {
  try {
    return await prisma.user.findUnique({
      where: { email },
      include: { memberships: true },
    });
  } catch (error) {
    logDbError("login_lookup_failed", error);
    throw error;
  }
}

/** Best-effort source IP from the standard reverse-proxy header (Render sits behind one) — null locally, where there's no proxy setting it. */
async function getClientIp(): Promise<string | null> {
  const headerList = await headers();
  const forwardedFor = headerList.get("x-forwarded-for");
  if (forwardedFor) return forwardedFor.split(",")[0]!.trim();
  return headerList.get("x-real-ip");
}

export async function loginAction(_prevState: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Enter your email and password." };
  }

  // Deliberately generic error for both "no such user" and "wrong password" —
  // never reveal which one to an unauthenticated caller.
  const genericError = { error: "That email or password isn't right." };
  const rateLimitError = { error: "Too many attempts. Please wait a few minutes and try again." };

  const identifier = normalizeLoginIdentifier(email);
  const ip = await getClientIp();

  // Checked before touching the database or bcrypt at all — a locked-out
  // request costs nothing and, since this check is keyed purely on the
  // submitted identifier (real account or not), it can't be used to
  // distinguish a real email from a made-up one either.
  if (await isLoginRateLimited(identifier, ip)) {
    return rateLimitError;
  }

  const user = await findUserForLogin(email);
  // Always run a real bcrypt.compare(), even when no user matches — against
  // a fixed dummy hash in that case — so a nonexistent email doesn't return
  // measurably faster than a real one with a wrong password (security audit
  // finding H2: never expose whether a supplied email is a valid account).
  const passwordOk = await verifyPassword(password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);

  if (!user || !passwordOk) {
    await recordLoginAttempt(identifier, ip, false);
    return genericError;
  }

  const membership = user.memberships[0];
  if (!membership) return { error: "This account isn't attached to a household yet." };

  await recordLoginAttempt(identifier, ip, true);

  await createSession({
    userId: user.id,
    householdId: membership.householdId,
    householdMemberId: membership.id,
    role: membership.role,
  });

  redirect("/");
}
