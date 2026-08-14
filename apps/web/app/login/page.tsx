import { getSession } from "@/lib/session";
import { redirect } from "next/navigation";
import { LoginForm } from "./LoginForm";

export default async function LoginPage() {
  const session = await getSession();
  if (session) redirect("/");

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6 py-12">
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-semibold" style={{ color: "var(--color-text)" }}>
          FrodoCodo
        </h1>
        <p className="mt-1 text-sm" style={{ color: "var(--color-text-muted)" }}>
          Where does the household stand right now?
        </p>
      </div>
      <LoginForm />
    </main>
  );
}
