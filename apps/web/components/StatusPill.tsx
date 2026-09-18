export function StatusPill({ label, color, soft }: { label: string; color: string; soft: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold whitespace-nowrap"
      style={{ background: soft, color }}
    >
      {label}
    </span>
  );
}
