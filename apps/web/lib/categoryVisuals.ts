/**
 * Icon + color mapping for buckets/categories, purely presentational. Names
 * are household-defined free text (seed data or future user-created
 * buckets/categories) — this matches on common finance keywords with a
 * deterministic fallback (icon + color both derived from the name itself)
 * so it degrades gracefully for any name we haven't seen, rather than
 * requiring every household's categories to be enumerated here.
 */

const ICON_RULES: Array<{ pattern: RegExp; icon: string }> = [
  { pattern: /grocer|supermarket/i, icon: "🛒" },
  { pattern: /fuel|petrol/i, icon: "⛽" },
  { pattern: /transport|\bcar\b|uber|taxi|parking|rego/i, icon: "🚗" },
  { pattern: /dining|takeaway|restaurant|cafe|eating/i, icon: "🍽️" },
  { pattern: /hous(e|ing)|mortgage|\brent\b/i, icon: "🏠" },
  { pattern: /utilit|electric|energy|water bill|\bgas\b/i, icon: "💡" },
  { pattern: /insurance/i, icon: "🛡️" },
  { pattern: /subscription|streaming/i, icon: "🎬" },
  { pattern: /shop|retail/i, icon: "🛍️" },
  { pattern: /famil|child|kid/i, icon: "👨‍👩‍👧" },
  { pattern: /saving|goal/i, icon: "💰" },
  { pattern: /health|medical|pharmac/i, icon: "💊" },
  { pattern: /travel|holiday|flight/i, icon: "✈️" },
  { pattern: /gift/i, icon: "🎁" },
  { pattern: /lifestyle|discretionary/i, icon: "✨" },
  { pattern: /essential/i, icon: "🧾" },
];

const FALLBACK_ICON = "💳";

/** Keys into the --cat-N / --cat-N-soft custom properties (app/globals.css). */
const PALETTE_SIZE = 8;

export function categoryIcon(name: string): string {
  return ICON_RULES.find((rule) => rule.pattern.test(name))?.icon ?? FALLBACK_ICON;
}

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

export function categoryColor(name: string): { color: string; soft: string } {
  const index = (hashString(name) % PALETTE_SIZE) + 1;
  return { color: `var(--cat-${index})`, soft: `var(--cat-${index}-soft)` };
}
