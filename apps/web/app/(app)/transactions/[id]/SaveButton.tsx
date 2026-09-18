"use client";

import { useFormStatus } from "react-dom";

/**
 * Immediate visual feedback the moment Save is tapped — production defect:
 * with no pending state, a slow request (e.g. the free-tier container
 * still waking up from being idle) looked indistinguishable from "nothing
 * happened", since the button gave no sign it had registered the tap.
 * `useFormStatus` only works inside a `<form>`, which is why this is its
 * own client component rather than inline in the (server component)
 * detail page.
 */
export function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="self-start rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
      style={{ background: "var(--color-accent)" }}
    >
      {pending ? "Saving…" : "Save"}
    </button>
  );
}
