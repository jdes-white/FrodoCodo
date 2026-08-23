import { requireSession, getCurrentUser } from "@/lib/session";
import { prisma } from "@frodocodo/db";
import { NavBar } from "@/components/NavBar";
import { SwipeNavigation } from "@/components/SwipeNavigation";
import { logoutAction } from "@/lib/actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const [user, household] = await Promise.all([
    getCurrentUser(session),
    prisma.household.findUniqueOrThrow({ where: { id: session.householdId } }),
  ]);

  return (
    <div className="flex min-h-screen flex-col sm:flex-row">
      <NavBar />
      <SwipeNavigation>
        <div className="flex-1 pb-20 sm:pb-0">
          <header
            className="flex h-16 items-center justify-between gap-3 border-b px-4 sm:px-6"
            style={{ borderColor: "var(--color-border)" }}
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{household.name}</p>
              <p className="truncate text-xs" style={{ color: "var(--color-text-muted)" }}>
                {user.name}
                {session.role === "ADMIN" ? " · Admin" : ""}
              </p>
            </div>
            <form action={logoutAction} className="shrink-0">
              <button type="submit" className="text-xs" style={{ color: "var(--color-text-muted)" }}>
                Sign out
              </button>
            </form>
          </header>
          <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6">{children}</main>
        </div>
      </SwipeNavigation>
    </div>
  );
}
