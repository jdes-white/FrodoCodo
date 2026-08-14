import "server-only";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@frodocodo/db";

/**
 * Hand-rolled, signed, httpOnly-cookie session (§33 secure session management).
 * Deliberately right-sized for a two-user household rather than pulling in a
 * full auth framework: a signed JWT session cookie, verified server-side on
 * every request. No session table — logout just clears the cookie; token
 * lifetime is capped below.
 */

const COOKIE_NAME = "frodocodo_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 14; // 14 days

export interface SessionPayload {
  userId: string;
  householdId: string;
  householdMemberId: string;
  role: "ADMIN" | "MEMBER";
}

function getSecret(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not configured");
  return new TextEncoder().encode(secret);
}

export async function createSession(payload: SessionPayload): Promise<void> {
  const token = await new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(getSecret());

  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export async function destroySession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}

export async function getSession(): Promise<SessionPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, getSecret());
    return {
      userId: payload.userId as string,
      householdId: payload.householdId as string,
      householdMemberId: payload.householdMemberId as string,
      role: payload.role as "ADMIN" | "MEMBER",
    };
  } catch {
    return null;
  }
}

/** Redirects to /login when there's no valid session. Use in every protected server component. */
export async function requireSession(): Promise<SessionPayload> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

/** Redirects non-admins away from admin-only pages/actions (§5 permissions). */
export async function requireAdmin(): Promise<SessionPayload> {
  const session = await requireSession();
  if (session.role !== "ADMIN") redirect("/");
  return session;
}

export async function getCurrentUser(session: SessionPayload) {
  return prisma.user.findUniqueOrThrow({ where: { id: session.userId } });
}
