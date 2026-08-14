interface CategoryOption {
  id: string;
  name: string;
  bucket: { name: string };
}

interface AccountOption {
  id: string;
  displayName: string;
}

export function TransactionFiltersForm({
  categories,
  accounts,
  current,
}: {
  categories: CategoryOption[];
  accounts: AccountOption[];
  current: { categoryId?: string; accountId?: string; merchantQuery?: string; needsReviewOnly?: string };
}) {
  return (
    <form
      method="get"
      className="flex flex-wrap items-end gap-2 rounded-2xl border p-3"
      style={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}
    >
      <div className="flex flex-col gap-1">
        <label className="text-xs" style={{ color: "var(--color-text-muted)" }}>
          Merchant
        </label>
        <input
          name="merchantQuery"
          defaultValue={current.merchantQuery}
          placeholder="Search..."
          className="rounded-lg border px-2 py-1.5 text-sm"
          style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs" style={{ color: "var(--color-text-muted)" }}>
          Category
        </label>
        <select
          name="categoryId"
          defaultValue={current.categoryId ?? ""}
          className="rounded-lg border px-2 py-1.5 text-sm"
          style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}
        >
          <option value="">All</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.bucket.name} · {c.name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs" style={{ color: "var(--color-text-muted)" }}>
          Account
        </label>
        <select
          name="accountId"
          defaultValue={current.accountId ?? ""}
          className="rounded-lg border px-2 py-1.5 text-sm"
          style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}
        >
          <option value="">All</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.displayName}
            </option>
          ))}
        </select>
      </div>
      <label className="flex items-center gap-1.5 pb-1.5 text-sm">
        <input type="checkbox" name="needsReviewOnly" value="1" defaultChecked={current.needsReviewOnly === "1"} />
        Needs review only
      </label>
      <button
        type="submit"
        className="rounded-lg px-3 py-1.5 text-sm font-medium text-white"
        style={{ background: "var(--color-accent)" }}
      >
        Filter
      </button>
    </form>
  );
}
