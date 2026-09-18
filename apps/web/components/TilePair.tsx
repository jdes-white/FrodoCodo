"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "./Card";
import { updateNorthStarField, toggleReinvestInvestmentIncome } from "@/app/(app)/north-star/actions";

const MUTED = { color: "var(--color-text-muted)" } as const;

interface BaseTile {
  icon: string;
  label: string;
  displayValue: string;
  title: string;
  description?: string;
}

export interface NumberTileConfig extends BaseTile {
  kind: "number";
  field: string;
  currentValue: number;
  step?: string;
  min?: number;
  suffix?: string;
}

export interface ToggleTileConfig extends BaseTile {
  kind: "toggle";
  currentValue: boolean;
}

export type TileConfig = NumberTileConfig | ToggleTileConfig;

/**
 * A pair of compact assumption tiles that share one expand/collapse slot
 * (Page 2 redesign — "show the numbers first, explain or edit one only
 * when asked"). Collapsed: two tiles side by side, icon + short label +
 * value only. Tapping either one expands it across the full pair width
 * and hides its partner rather than pushing it into a new row, so the
 * layout never grows taller than "N pairs stacked" while one is open.
 * Either tile can be the one that expands — there's no fixed left/right
 * role, just whichever the household tapped.
 */
export function TilePair({ left, right }: { left: TileConfig; right: TileConfig }) {
  const [expanded, setExpanded] = useState<"left" | "right" | null>(null);

  return (
    <div className="grid grid-cols-2 gap-2">
      {expanded === null && (
        <>
          <CompactTile tile={left} onTap={() => setExpanded("left")} />
          <CompactTile tile={right} onTap={() => setExpanded("right")} />
        </>
      )}
      {expanded === "left" && <ExpandedTile tile={left} onDone={() => setExpanded(null)} />}
      {expanded === "right" && <ExpandedTile tile={right} onDone={() => setExpanded(null)} />}
    </div>
  );
}

function CompactTile({ tile, onTap }: { tile: TileConfig; onTap: () => void }) {
  return (
    <button
      type="button"
      onClick={onTap}
      className="flex min-w-0 flex-col items-start gap-0.5 rounded-2xl border p-2 text-left shadow-[var(--shadow-card)] transition active:scale-[0.98]"
      style={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}
    >
      <span className="flex items-center gap-1.5">
        <span
          className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px]"
          style={{ background: "var(--color-accent-soft)", color: "var(--color-accent)" }}
          aria-hidden
        >
          {tile.icon}
        </span>
        <span className="truncate text-[10px] font-medium" style={MUTED}>
          {tile.label}
        </span>
      </span>
      <span className="text-sm leading-tight font-bold">{tile.displayValue}</span>
    </button>
  );
}

function ExpandedTile({ tile, onDone }: { tile: TileConfig; onDone: () => void }) {
  // Mount-triggered fade/scale so the expand reads as a quick, app-like
  // transition rather than the pair just snapping to its new shape.
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setSettled(true));
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <div className={`col-span-2 origin-top transition-all duration-150 ease-out ${settled ? "scale-100 opacity-100" : "scale-95 opacity-0"}`}>
      <Card padding="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold">{tile.title}</p>
            {tile.description && (
              <p className="mt-0.5 text-xs" style={MUTED}>
                {tile.description}
              </p>
            )}
          </div>
          <button type="button" onClick={onDone} className="shrink-0 text-xs font-semibold" style={{ color: "var(--color-accent)" }}>
            Done
          </button>
        </div>
        <div className="mt-3">{tile.kind === "number" ? <NumberEditor tile={tile} onSaved={onDone} /> : <ToggleEditor tile={tile} onSaved={onDone} />}</div>
      </Card>
    </div>
  );
}

function NumberEditor({ tile, onSaved }: { tile: NumberTileConfig; onSaved: () => void }) {
  const router = useRouter();
  const [value, setValue] = useState(tile.currentValue);
  const [pending, setPending] = useState(false);

  async function handleSave() {
    setPending(true);
    const formData = new FormData();
    formData.set("field", tile.field);
    formData.set("value", String(value));
    try {
      await updateNorthStarField(formData);
      // The server action's revalidatePath only invalidates the cache —
      // this is what actually re-renders the Server Component tree (and
      // therefore this tile's collapsed displayValue) with the fresh row,
      // since the save was triggered by a plain click handler rather than
      // a <form> submission (which would trigger this automatically).
      router.refresh();
      onSaved();
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <input
        type="number"
        inputMode="decimal"
        value={value}
        onChange={(e) => setValue(Number(e.target.value))}
        step={tile.step ?? "any"}
        min={tile.min}
        aria-label={tile.label}
        // 16px (text-base) is deliberate — anything smaller triggers iOS
        // Safari's input-focus zoom (see AskCoach.tsx).
        className="min-w-0 flex-1 rounded-lg border px-2.5 py-2 text-base"
        style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}
      />
      {tile.suffix && (
        <span className="shrink-0 text-xs" style={MUTED}>
          {tile.suffix}
        </span>
      )}
      <button
        type="button"
        onClick={handleSave}
        disabled={pending}
        className="shrink-0 rounded-lg px-3 py-2 text-xs font-semibold disabled:opacity-60"
        style={{ background: "var(--color-accent)", color: "#fff" }}
      >
        {pending ? "Saving…" : "Save"}
      </button>
    </div>
  );
}

function ToggleEditor({ tile, onSaved }: { tile: ToggleTileConfig; onSaved: () => void }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function handleChoose(next: boolean) {
    if (next === tile.currentValue) {
      onSaved();
      return;
    }
    setPending(true);
    const formData = new FormData();
    formData.set("reinvest", String(next));
    try {
      await toggleReinvestInvestmentIncome(formData);
      router.refresh();
      onSaved();
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex gap-2">
      {[true, false].map((option) => (
        <button
          key={String(option)}
          type="button"
          disabled={pending}
          onClick={() => handleChoose(option)}
          className="flex-1 rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-60"
          style={{
            background: tile.currentValue === option ? "var(--status-ahead-soft)" : "var(--color-border)",
            color: tile.currentValue === option ? "var(--status-ahead)" : "var(--color-text-muted)",
          }}
        >
          {option ? "Yes" : "No"}
        </button>
      ))}
    </div>
  );
}
