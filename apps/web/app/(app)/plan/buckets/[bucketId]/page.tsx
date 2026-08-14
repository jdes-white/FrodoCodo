import { notFound } from "next/navigation";
import Link from "next/link";
import { formatAUD } from "@frodocodo/shared";
import { requireSession } from "@/lib/session";
import { getBudgetSnapshot } from "@/lib/budgetSnapshot";
import { listTransactions } from "@/lib/transactions";
import { statusLabel, statusColorVar } from "@/lib/statusDisplay";
import { ProgressBar } from "@/components/ProgressBar";
import { TransactionList } from "@/components/TransactionList";

export default async function BucketDetailPage({ params }: { params: Promise<{ bucketId: string }> }) {
  const { bucketId } = await params;
  const session = await requireSession();
  const snapshot = await getBudgetSnapshot(session.householdId);

  const bucket = snapshot.buckets.find((b) => b.bucketId === bucketId);
  if (!bucket) notFound();

  const transactions = await listTransactions(session.householdId, { bucketId, limit: 15 });

  return (
    <div className="flex flex-col gap-6">
      <Link href="/" className="text-sm" style={{ color: "var(--color-text-muted)" }}>
        ← Back to dashboard
      </Link>

      <section
        className="rounded-3xl border p-6"
        style={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}
      >
        <h1 className="text-xl font-semibold">{bucket.name}</h1>
        <p className="mt-2 text-3xl font-semibold">{formatAUD(bucket.pacing.remaining)}</p>
        <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
          remaining of {formatAUD(bucket.pacing.allocation)}
        </p>
        <div
          className="mt-3 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium"
          style={{ background: `${statusColorVar(bucket.pacing.pacingStatus)}1a`, color: statusColorVar(bucket.pacing.pacingStatus) }}
        >
          {statusLabel(bucket.pacing.pacingStatus)}
        </div>
        <div className="mt-4">
          <ProgressBar percent={bucket.pacing.percentConsumed} colorVar={statusColorVar(bucket.pacing.pacingStatus)} />
        </div>
        <p className="mt-3 text-xs" style={{ color: "var(--color-text-muted)" }}>
          Projected to finish at {formatAUD(bucket.pacing.projectedEndOfPeriod)}
          {bucket.pacing.projectedVariance.greaterThan(0)
            ? ` — about ${formatAUD(bucket.pacing.projectedVariance)} over budget at this rate.`
            : ` — about ${formatAUD(bucket.pacing.projectedVariance.abs())} under budget at this rate.`}
        </p>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-medium" style={{ color: "var(--color-text-muted)" }}>
          Categories
        </h2>
        <div className="flex flex-col gap-2">
          {bucket.categories.map((category) => (
            <div
              key={category.categoryId}
              className="flex items-center justify-between rounded-xl border px-4 py-3"
              style={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}
            >
              <div>
                <p className="text-sm font-medium">{category.name}</p>
                <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
                  {formatAUD(category.pacing.spentToDate)} of {formatAUD(category.pacing.allocation)}
                </p>
              </div>
              <span className="text-xs font-medium" style={{ color: statusColorVar(category.pacing.pacingStatus) }}>
                {statusLabel(category.pacing.pacingStatus)}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-medium" style={{ color: "var(--color-text-muted)" }}>
          Recent transactions
        </h2>
        <TransactionList transactions={transactions} />
      </section>
    </div>
  );
}
