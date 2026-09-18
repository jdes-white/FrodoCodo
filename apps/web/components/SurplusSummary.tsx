"use client";

import { useState } from "react";
import { Card } from "./Card";

const MUTED = { color: "var(--color-text-muted)" } as const;

/**
 * Available surplus is calculated (employment income − lifestyle to
 * fund), not an assumption — it deliberately doesn't get a TilePair slot
 * or edit controls, just a slim summary row that can optionally expand to
 * show the breakdown. Never editable.
 */
export function SurplusSummary({ employmentIncome, lifestyleTarget, surplus }: { employmentIncome: string; lifestyleTarget: string; surplus: string }) {
  const [open, setOpen] = useState(false);

  return (
    <button type="button" onClick={() => setOpen((o) => !o)} className="block w-full text-left">
      <Card padding="p-2" className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium" style={MUTED}>
            Available surplus
          </span>
          <span className="text-sm font-semibold">{surplus} p.a.</span>
        </div>
        {open && (
          <div className="flex flex-col gap-0.5 border-t pt-1.5 text-xs" style={{ borderColor: "var(--color-border)" }}>
            <div className="flex justify-between">
              <span style={MUTED}>Employment income</span>
              <span>{employmentIncome}</span>
            </div>
            <div className="flex justify-between">
              <span style={MUTED}>− Lifestyle to fund</span>
              <span>{lifestyleTarget}</span>
            </div>
            <div className="flex justify-between font-semibold">
              <span>= Available surplus</span>
              <span>{surplus}</span>
            </div>
          </div>
        )}
      </Card>
    </button>
  );
}
