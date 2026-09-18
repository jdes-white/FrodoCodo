export function PageHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div>
      <h1 className="text-2xl font-bold">{title}</h1>
      {subtitle && (
        <p className="mt-0.5 text-sm" style={{ color: "var(--color-text-muted)" }}>
          {subtitle}
        </p>
      )}
    </div>
  );
}
