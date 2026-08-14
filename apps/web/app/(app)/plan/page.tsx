import { formatAUD } from "@frodocodo/shared";
import { requireSession } from "@/lib/session";
import { getBudgetSnapshot } from "@/lib/budgetSnapshot";
import { updateAllocations } from "./actions";
import { ScenarioModeller } from "./ScenarioModeller";

export default async function PlanPage() {
  const session = await requireSession();
  const snapshot = await getBudgetSnapshot(session.householdId);
  const isAdmin = session.role === "ADMIN";

  const allCategories = snapshot.buckets.flatMap((b) =>
    b.categories.map((c) => ({ categoryId: c.categoryId, name: c.name, bucketName: b.name, allocation: c.pacing.allocation })),
  );

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-lg font-semibold">Plan</h1>

      <section
        className="rounded-2xl border p-5"
        style={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}
      >
        <h2 className="mb-3 text-sm font-medium">This period&apos;s budget</h2>
        <form action={updateAllocations} className="flex flex-col gap-3">
          <input type="hidden" name="budgetPeriodId" value={snapshot.budgetPeriodId} />
          {snapshot.buckets.map((bucket) => (
            <div key={bucket.bucketId}>
              <p className="mb-1.5 text-xs font-medium" style={{ color: "var(--color-text-muted)" }}>
                {bucket.name}
              </p>
              <div className="flex flex-col gap-1.5">
                {bucket.categories.map((category) => (
                  <div key={category.categoryId} className="flex items-center justify-between gap-3">
                    <label htmlFor={`alloc-${category.categoryId}`} className="text-sm">
                      {category.name}
                    </label>
                    {isAdmin ? (
                      <input
                        id={`alloc-${category.categoryId}`}
                        name={`allocation:${category.categoryId}`}
                        type="number"
                        step="1"
                        min="0"
                        defaultValue={category.pacing.allocation.toNumber()}
                        className="w-28 rounded-lg border px-2 py-1 text-right text-sm"
                        style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}
                      />
                    ) : (
                      <span className="text-sm">{formatAUD(category.pacing.allocation)}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
          {isAdmin && (
            <button
              type="submit"
              className="mt-2 self-start rounded-lg px-4 py-2 text-sm font-medium text-white"
              style={{ background: "var(--color-accent)" }}
            >
              Save budget
            </button>
          )}
        </form>
      </section>

      <section
        className="rounded-2xl border p-5"
        style={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}
      >
        <h2 className="mb-1 text-sm font-medium">What if?</h2>
        <p className="mb-3 text-xs" style={{ color: "var(--color-text-muted)" }}>
          Model a change before committing to it. Nothing here is saved until you update the budget above.
        </p>
        <ScenarioModeller categories={allCategories.map((c) => ({ ...c, allocation: c.allocation.toNumber() }))} />
      </section>
    </div>
  );
}
