"use client";

import { useActionState } from "react";
import { loginAction, type LoginState } from "./actions";
import { Card } from "@/components/Card";

const initialState: LoginState = {};

export function LoginForm() {
  const [state, formAction, isPending] = useActionState(loginAction, initialState);

  return (
    <Card as="form" action={formAction} className="flex flex-col gap-4 rounded-3xl">
      <div className="flex flex-col gap-1">
        <label htmlFor="email" className="text-sm font-medium">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          className="rounded-xl border px-3 py-2 text-base outline-none"
          style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="password" className="text-sm font-medium">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
          className="rounded-xl border px-3 py-2 text-base outline-none"
          style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}
        />
      </div>
      {state.error && (
        <p className="text-sm" style={{ color: "var(--status-behind)" }}>
          {state.error}
        </p>
      )}
      <button
        type="submit"
        disabled={isPending}
        className="mt-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
        style={{ background: "var(--color-accent)" }}
      >
        {isPending ? "Signing in..." : "Sign in"}
      </button>
    </Card>
  );
}
