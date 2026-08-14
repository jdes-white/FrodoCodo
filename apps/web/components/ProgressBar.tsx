export function ProgressBar({ percent, colorVar }: { percent: number; colorVar: string }) {
  const clamped = Math.min(Math.max(percent, 0), 100);
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full" style={{ background: "var(--color-border)" }}>
      <div className="h-full rounded-full" style={{ width: `${clamped}%`, background: colorVar }} />
    </div>
  );
}
