"use server";

import { redirect } from "next/navigation";
import { prisma } from "@frodocodo/db";
import { verifyPassword } from "@/lib/password";
import { createSession } from "@/lib/session";

export interface LoginState {
  error?: string;
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

  const user = await prisma.user.findUnique({
    where: { email },
    include: { memberships: true },
  });
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
