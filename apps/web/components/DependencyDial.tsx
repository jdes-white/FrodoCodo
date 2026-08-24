"use client";

const SIZE_W = 240;
const SIZE_H = 150;
const CENTER_X = 120;
const CENTER_Y = 120;
const RADIUS = 96;
const STROKE = 14;

const ARC_PATH = `M ${CENTER_X - RADIUS} ${CENTER_Y} A ${RADIUS} ${RADIUS} 0 0 1 ${CENTER_X + RADIUS} ${CENTER_Y}`;

/** 100% sits at the left end of the arc, 0% at the right (§6/§7) — angle
 * sweeps 180°→0° as percent goes 100→0, matching a standard unit-circle
 * upper semicircle (percent 50 lands exactly at the top). */
function pointFor(percent: number) {
  const angleRad = ((percent / 100) * 180 * Math.PI) / 180;
  return { x: CENTER_X + RADIUS * Math.cos(angleRad), y: CENTER_Y - RADIUS * Math.sin(angleRad) };
}

/**
 * The interactive Employment Dependency gauge (§7). Purely presentational
 * and fully controlled — `value` is whatever the parent
 * (components/NorthStarHero.tsx) wants displayed, and dragging just
 * reports the new value via `onChange`. It used to own its own transient
 * drag state and snap back to the live default on release; now that
 * exploring the dial creates a persistent scenario the household can walk
 * away from and come back to, "what happens when you let go" is entirely
 * the parent's call, not this component's — see NorthStarHero for the
 * scenario-vs-live logic.
 *
 * `actualPercent` is the household's real, current dependency figure —
 * always drawn as a separate, fixed marker on the arc so it stays
 * identifiable no matter what the draggable handle is currently exploring.
 *
 * Implementation: an invisible native `<input type="range">` (dir="rtl" so
 * dragging left increases the value, matching 100% sitting on the left)
 * is layered over a custom SVG arc rather than hand-rolling pointer-event
 * angle math — this gets keyboard support, touch/mouse dragging, and
 * accessibility semantics for free. The visible thumb is hidden
 * (.dial-range in globals.css); the SVG circle is the only thing the user
 * sees move.
 */
export function DependencyDial({
  actualPercent,
  value,
  onChange,
}: {
  actualPercent: number;
  value: number;
  onChange: (percent: number) => void;
}) {
  const actualPoint = pointFor(actualPercent);
  const handlePoint = pointFor(value);

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative mx-auto w-full" style={{ maxWidth: 160 }}>
        <svg viewBox={`0 0 ${SIZE_W} ${SIZE_H}`} className="w-full" aria-hidden>
          <defs>
            <linearGradient id="dependency-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="var(--status-behind)" />
              <stop offset="100%" stopColor="var(--status-ahead)" />
            </linearGradient>
          </defs>
          <path d={ARC_PATH} fill="none" stroke="url(#dependency-gradient)" strokeWidth={STROKE} strokeLinecap="round" opacity={0.85} />
          <circle cx={actualPoint.x} cy={actualPoint.y} r={6} fill="var(--color-surface)" stroke="var(--color-text)" strokeWidth={2.5} />
          <circle cx={handlePoint.x} cy={handlePoint.y} r={10} fill="var(--color-accent)" stroke="var(--color-surface)" strokeWidth={3} />
        </svg>

        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={value}
          dir="rtl"
          aria-label="Explore a different employment dependency level"
          onChange={(e) => onChange(Number(e.target.value))}
          className="dial-range absolute inset-x-0 top-0 h-full w-full cursor-pointer"
        />
      </div>

      <div className="flex w-full justify-between px-1 text-[11px] font-medium" style={{ color: "var(--color-text-muted)" }}>
        <span>100% · Salary dependent</span>
        <span>0% · Work optional</span>
      </div>

      <div className="text-center">
        <p className="text-2xl font-extrabold tracking-tight">{actualPercent.toFixed(1)}%</p>
        <p className="text-[11px]" style={{ color: "var(--color-text-muted)" }}>
          Employment dependency today
        </p>
      </div>
    </div>
  );
}
