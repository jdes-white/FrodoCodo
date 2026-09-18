const FIELD_STYLE = { borderColor: "var(--color-border)", background: "var(--color-bg)" } as const;

export interface CategoryOption {
  id: string;
  name: string;
  bucketName: string;
}

/**
 * The category select, plus the three inputs + recurrence select, shared
 * by both the "add a commitment" and "edit a commitment" forms
 * (CommitmentCard.tsx, AddCommitmentCard.tsx) — same fields either way,
 * just different initial values and a different action on save. No hooks
 * of its own, so it needs no "use client" directive; it's only ever
 * rendered from within an already-client component tree.
 *
 * The category is always an explicit household choice — grouped by bucket
 * so the household can find "Mortgage/Housing" under "Essentials" the same
 * way the four Home Page 2 cards group categories, but never pre-derived
 * from transaction history (see packages/domain/src/commitments.ts).
 */
export function CommitmentFormFields({
  name,
  amount,
  expectedDate,
  recurrence,
  categoryId,
  categories,
  onNameChange,
  onAmountChange,
  onExpectedDateChange,
  onRecurrenceChange,
  onCategoryChange,
}: {
  name: string;
  amount: string;
  expectedDate: string;
  recurrence: string;
  categoryId: string;
  categories: CategoryOption[];
  onNameChange: (value: string) => void;
  onAmountChange: (value: string) => void;
  onExpectedDateChange: (value: string) => void;
  onRecurrenceChange: (value: string) => void;
  onCategoryChange: (value: string) => void;
}) {
  const bucketNames = [...new Set(categories.map((c) => c.bucketName))];

  return (
    <div className="flex flex-col gap-2">
      <input
        value={name}
        onChange={(e) => onNameChange(e.target.value)}
        placeholder="Name (e.g. Mortgage)"
        aria-label="Name"
        // 16px (text-base) avoids iOS Safari's input-focus zoom (see AskCoach.tsx).
        className="rounded-lg border px-2.5 py-2 text-base"
        style={FIELD_STYLE}
      />
      <div className="flex gap-2">
        <input
          type="number"
          step="0.01"
          min="0.01"
          value={amount}
          onChange={(e) => onAmountChange(e.target.value)}
          placeholder="Amount"
          aria-label="Amount"
          className="min-w-0 flex-1 rounded-lg border px-2.5 py-2 text-base"
          style={FIELD_STYLE}
        />
        <input
          type="date"
          value={expectedDate}
          onChange={(e) => onExpectedDateChange(e.target.value)}
          aria-label="Expected date"
          className="min-w-0 flex-1 rounded-lg border px-2.5 py-2 text-base"
          style={FIELD_STYLE}
        />
      </div>
      <select
        value={recurrence}
        onChange={(e) => onRecurrenceChange(e.target.value)}
        aria-label="Repeats"
        className="rounded-lg border px-2.5 py-2 text-sm"
        style={FIELD_STYLE}
      >
        <option value="">One-off</option>
        <option value="WEEKLY">Repeats weekly</option>
        <option value="FORTNIGHTLY">Repeats fortnightly</option>
        <option value="MONTHLY">Repeats monthly</option>
      </select>
      <select
        value={categoryId}
        onChange={(e) => onCategoryChange(e.target.value)}
        aria-label="Category"
        className="rounded-lg border px-2.5 py-2 text-sm"
        style={FIELD_STYLE}
      >
        <option value="">Choose a category</option>
        {bucketNames.map((bucketName) => (
          <optgroup key={bucketName} label={bucketName}>
            {categories
              .filter((c) => c.bucketName === bucketName)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </optgroup>
        ))}
      </select>
    </div>
  );
}
