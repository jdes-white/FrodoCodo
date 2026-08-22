import type { ReactNode } from "react";
import { Card } from "./Card";
import { updateNorthStarField } from "@/app/(app)/north-star/actions";

const MUTED = { color: "var(--color-text-muted)" } as const;

/**
 * Tap-to-edit assumption row for North Star's Page 2 (§11) — zero-JS
 * `<details>/<summary>` disclosure instead of a permanent input box, so
 * the "Build your engine" section reads as a normal list at rest and only
 * turns into a form when tapped. The wrapping `<form action={...}>` posts
 * straight to the generic `updateNorthStarField` server action, so this
 * component needs no client-side JavaScript at all.
 */
export function EditableRow({
  icon,
  label,
  displayValue,
  sublabel,
  field,
  currentValue,
  step = "any",
  min = 0,
  suffix,
}: {
  icon: string;
  label: string;
  displayValue: string;
  sublabel?: ReactNode;
  field: string;
  currentValue: number;
  step?: string;
  min?: number;
  suffix?: string;
}) {
  return (
    <Card padding="p-0" className="overflow-hidden">
      <details className="group">
        <summary className="flex cursor-pointer list-none items-center gap-2.5 p-3 [&::-webkit-details-marker]:hidden">
          <span
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm"
            style={{ background: "var(--color-accent-soft)", color: "var(--color-accent)" }}
            aria-hidden
          >
            {icon}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium">{label}</span>
            {sublabel && (
              <span className="block text-[11px]" style={MUTED}>
                {sublabel}
              </span>
            )}
          </span>
          <span className="shrink-0 text-sm font-semibold">{displayValue}</span>
          <span className="shrink-0 text-xs transition-transform group-open:rotate-180" style={MUTED} aria-hidden>
            ⌄
          </span>
        </summary>
        <form action={updateNorthStarField} className="flex items-center gap-2 border-t px-3 py-2.5" style={{ borderColor: "var(--color-border)" }}>
          <input type="hidden" name="field" value={field} />
          <input
            name="value"
            type="number"
            defaultValue={currentValue}
            step={step}
            min={min}
            inputMode="decimal"
            aria-label={label}
            // 16px (text-base) is deliberate — anything smaller triggers
            // iOS Safari's input-focus zoom (see AskCoach.tsx).
            className="min-w-0 flex-1 rounded-lg border px-2.5 py-2 text-base"
            style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}
          />
          {suffix && (
            <span className="shrink-0 text-xs" style={MUTED}>
              {suffix}
            </span>
          )}
          <button type="submit" className="shrink-0 rounded-lg px-3 py-2 text-xs font-semibold" style={{ background: "var(--color-accent)", color: "#fff" }}>
            Save
          </button>
        </form>
      </details>
    </Card>
  );
}
