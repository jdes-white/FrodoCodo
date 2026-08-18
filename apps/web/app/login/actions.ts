"use server";

import { redirect } from "next/navigation";
import { prisma, logDbError } from "@frodocodo/db";
import { verifyPassword } from "@/lib/password";
import { createSession } from "@/lib/session";

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

export async function loginAction(_prevState: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Enter your email and password." };
  }

  // Deliberately generic error for both "no such user" and "wrong password" —
  // never reveal which one to an unauthenticated caller.
  const genericError = { error: "That email or password isn't right." };

  const user = await findUserForLogin(email);
  if (!user) return genericError;

  const passwordOk = await verifyPassword(password, user.passwordHash);
  if (!passwordOk) return genericError;

  const membership = user.memberships[0];
  if (!membership) return { error: "This account isn't attached to a household yet." };

  await createSession({
    userId: user.id,
    householdId: membership.householdId,
    householdMemberId: membership.id,
    role: membership.role,
  });

  redirect("/");
}
