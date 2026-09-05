import type { ComponentPropsWithoutRef, ElementType, ReactNode } from "react";

/**
 * The one card treatment (rounded corners, surface background, border,
 * soft shadow) used everywhere instead of every page re-typing the same
 * `rounded-2xl border` + inline surface/border style. Forwards any other
 * props (e.g. `method`/`action` when `as="form"`) straight to the
 * rendered element.
 */
export function Card<T extends ElementType = "div">({
  children,
  className = "",
  as,
  padding = "p-5",
  style,
  ...rest
}: {
  children: ReactNode;
  className?: string;
  as?: T;
  padding?: string;
} & Omit<ComponentPropsWithoutRef<T>, "children" | "className" | "style">) {
  const Component = (as ?? "div") as ElementType;
  return (
    <Component
      className={`rounded-2xl border shadow-[var(--shadow-card)] ${padding} ${className}`}
      style={{ background: "var(--color-surface)", borderColor: "var(--color-border)", ...style }}
      {...rest}
    >
      {children}
    </Component>
  );
}
