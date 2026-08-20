export function ProgressBar({ percent, colorVar }: { percent: number; colorVar: string }) {
  const clamped = Math.min(Math.max(percent, 0), 100);
  return (
    <div className="h-2 w-full overflow-hidden rounded-full" style={{ background: "var(--color-border)" }}>
      <div className="h-full rounded-full transition-[width]" style={{ width: `${clamped}%`, background: colorVar }} />
    </div>
  );
}
