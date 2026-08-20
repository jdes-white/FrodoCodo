import { categoryIcon, categoryColor } from "@/lib/categoryVisuals";

export function CategoryIcon({ name, size = 40 }: { name: string; size?: number }) {
  const { soft } = categoryColor(name);
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-full"
      style={{ width: size, height: size, background: soft, fontSize: size * 0.5, lineHeight: 1 }}
      aria-hidden
    >
      {categoryIcon(name)}
    </span>
  );
}
