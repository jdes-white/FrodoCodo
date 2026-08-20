import { Card } from "./Card";

export function StatTile({ icon, label, value, sublabel }: { icon: string; label: string; value: string; sublabel: string }) {
  return (
    <Card className="flex min-w-0 flex-1 flex-col gap-1.5" padding="p-3">
      <div className="flex items-center gap-1.5">
        <span
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px]"
          style={{ background: "var(--color-accent-soft)", color: "var(--color-accent)" }}
          aria-hidden
        >
          {icon}
        </span>
        <span className="text-[9px] font-semibold tracking-wide uppercase" style={{ color: "var(--color-text-muted)" }}>
          {label}
        </span>
      </div>
      <p className="text-base leading-tight font-bold sm:text-lg">{value}</p>
      <p className="truncate text-[11px]" style={{ color: "var(--color-text-muted)" }}>
        {sublabel}
      </p>
    </Card>
  );
}
