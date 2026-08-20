import { notFound } from "next/navigation";
import Link from "next/link";
import { formatAUD } from "@frodocodo/shared";
import { deriveSpendPaceStatus, spendPaceLabel } from "@frodocodo/domain";
import { requireSession } from "@/lib/session";
import { getBudgetSnapshot } from "@/lib/budgetSnapshot";
import { listTransactions } from "@/lib/transactions";
import { spendPaceColorVar, spendPaceSoftColorVar } from "@/lib/statusDisplay";
import { ProgressBar } from "@/components/ProgressBar";
import { TransactionList } from "@/components/TransactionList";
import { Card } from "@/components/Card";
import { CategoryIcon } from "@/components/CategoryIcon";
import { StatusPill } from "@/components/StatusPill";

export default async function BucketDetailPage({ params }: { params: Promise<{ bucketId: string }> }) {
  const { bucketId } = await params;
  const session = await requireSession();
  const snapshot = await getBudgetSnapshot(session.householdId);

  const bucket = snapshot.buckets.find((b) => b.bucketId === bucketId);
  if (!bucket) notFound();

  const transactions = await listTransactions(session.householdId, { bucketId, limit: 15 });
  const bucketStatus = deriveSpendPaceStatus(bucket.pacing);

  return (
    <div className="flex flex-col gap-6">
      <Link href="/" className="text-sm" style={{ color: "var(--color-text-muted)" }}>
        ← Back to dashboard
      </Link>

      <Card as="section" padding="p-6" className="rounded-3xl">
        <div className="flex items-center gap-3">
          <CategoryIcon name={bucket.name} size={44} />
          <h1 className="text-xl font-semibold">{bucket.name}</h1>
        </div>
        <p className="mt-4 text-3xl font-semibold">{formatAUD(bucket.pacing.remaining)}</p>
        <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
          remaining of {formatAUD(bucket.pacing.allocation)}
        </p>
        <div className="mt-3">
          <StatusPill label={spendPaceLabel(bucketStatus)} color={spendPaceColorVar(bucketStatus)} soft={spendPaceSoftColorVar(bucketStatus)} />
        </div>
        <div className="mt-4">
          <ProgressBar percent={bucket.pacing.percentConsumed} colorVar={spendPaceColorVar(bucketStatus)} />
        </div>
        <p className="mt-3 text-xs" style={{ color: "var(--color-text-muted)" }}>
          Projected to finish at {formatAUD(bucket.pacing.projectedEndOfPeriod)}
          {bucket.pacing.projectedVariance.greaterThan(0)
            ? ` — about ${formatAUD(bucket.pacing.projectedVariance)} over budget at this rate.`
            : ` — about ${formatAUD(bucket.pacing.projectedVariance.abs())} under budget at this rate.`}
        </p>
      </Card>

      <section>
        <h2 className="mb-2 text-sm font-medium" style={{ color: "var(--color-text-muted)" }}>
          Categories
        </h2>
        <div className="flex flex-col gap-2">
          {bucket.categories.map((category) => {
            const categoryStatus = deriveSpendPaceStatus(category.pacing);
            return (
              <Card key={category.categoryId} padding="p-3.5">
                <div className="flex items-center gap-3">
                  <CategoryIcon name={category.name} size={36} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-sm font-medium">{category.name}</p>
                      <span className="shrink-0 text-xs font-medium" style={{ color: spendPaceColorVar(categoryStatus) }}>
                        {spendPaceLabel(categoryStatus)}
                      </span>
                    </div>
                    <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
                      {formatAUD(category.pacing.spentToDate)} of {formatAUD(category.pacing.allocation)}
                    </p>
                    <div className="mt-1.5">
                      <ProgressBar percent={category.pacing.percentConsumed} colorVar={spendPaceColorVar(categoryStatus)} />
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
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
