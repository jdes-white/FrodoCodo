import { notFound } from "next/navigation";
import Link from "next/link";
import { formatAUD } from "@frodocodo/shared";
import { requireSession } from "@/lib/session";
import { getTransactionDetail } from "@/lib/transactions";
import { listCategoriesWithBuckets } from "@/lib/categories";
import { fromPrismaDecimal } from "@/lib/decimal";
import { reclassifyTransaction, setExcludedFromBudget, markAsTransfer, updateNotes } from "./actions";
import { Card } from "@/components/Card";
import { CategoryIcon } from "@/components/CategoryIcon";

export default async function TransactionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();

  const [transaction, categories] = await Promise.all([
    getTransactionDetail(session.householdId, id),
    listCategoriesWithBuckets(session.householdId),
  ]);
  if (!transaction) notFound();

  return (
    <div className="flex flex-col gap-6">
      <Link href="/transactions" className="text-sm" style={{ color: "var(--color-text-muted)" }}>
        ← Back to transactions
      </Link>

      <Card as="section" className="rounded-3xl">
        <div className="flex items-center gap-3">
          <CategoryIcon name={transaction.category?.name ?? "Uncategorized"} size={40} />
          <div>
            <p className="text-2xl font-semibold">
              {transaction.direction === "CREDIT" ? "+" : "-"}
              {formatAUD(fromPrismaDecimal(transaction.amount))}
            </p>
            <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
              {transaction.merchant?.normalizedName ?? "Unrecognized merchant"}
            </p>
          </div>
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-y-2 text-sm">
          <dt style={{ color: "var(--color-text-muted)" }}>Original description</dt>
          <dd className="text-right">{transaction.originalDescription}</dd>
          <dt style={{ color: "var(--color-text-muted)" }}>Account</dt>
          <dd className="text-right">{transaction.account.displayName}</dd>
          <dt style={{ color: "var(--color-text-muted)" }}>Institution</dt>
          <dd className="text-right">{transaction.account.connection.institution.shortName}</dd>
          <dt style={{ color: "var(--color-text-muted)" }}>Date</dt>
          <dd className="text-right">{new Date(transaction.transactionDate).toLocaleDateString("en-AU")}</dd>
          <dt style={{ color: "var(--color-text-muted)" }}>Status</dt>
          <dd className="text-right">{transaction.status === "PENDING" ? "Pending" : "Posted"}</dd>
          {transaction.classificationSource && (
            <>
              <dt style={{ color: "var(--color-text-muted)" }}>Classified by</dt>
              <dd className="text-right">{formatSource(transaction.classificationSource)}</dd>
            </>
          )}
        </dl>
      </Card>

      <Card as="section">
        <h2 className="mb-3 text-sm font-medium">Reclassify</h2>
        <form action={reclassifyTransaction} className="flex flex-col gap-3">
          <input type="hidden" name="transactionId" value={transaction.id} />
          <select
            name="categoryId"
            defaultValue={transaction.categoryId ?? ""}
            required
            className="rounded-lg border px-3 py-2 text-sm"
            style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}
          >
            <option value="" disabled>
              Choose a category…
            </option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.bucket.name} · {c.name}
              </option>
            ))}
          </select>
          {transaction.merchant && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="applyToFutureFromMerchant" />
              Always classify {transaction.merchant.normalizedName} this way
            </label>
          )}
          <button
            type="submit"
            className="self-start rounded-lg px-4 py-2 text-sm font-medium text-white"
            style={{ background: "var(--color-accent)" }}
          >
            Save
          </button>
        </form>
      </Card>

      <Card as="section" className="flex flex-wrap gap-2">
        <form action={markAsTransfer}>
          <input type="hidden" name="transactionId" value={transaction.id} />
          <button type="submit" className="rounded-lg border px-3 py-1.5 text-sm" style={{ borderColor: "var(--color-border)" }}>
            Mark as transfer
          </button>
        </form>
        <form action={setExcludedFromBudget}>
          <input type="hidden" name="transactionId" value={transaction.id} />
          <input type="hidden" name="excluded" value={transaction.isExcludedFromBudget ? "" : "on"} />
          <button type="submit" className="rounded-lg border px-3 py-1.5 text-sm" style={{ borderColor: "var(--color-border)" }}>
            {transaction.isExcludedFromBudget ? "Include in budget" : "Exclude from budget"}
          </button>
        </form>
      </Card>

      <Card as="section">
        <h2 className="mb-3 text-sm font-medium">Notes</h2>
        <form action={updateNotes} className="flex flex-col gap-2">
          <input type="hidden" name="transactionId" value={transaction.id} />
          <textarea
            name="notes"
            defaultValue={transaction.notes ?? ""}
            rows={3}
            className="rounded-lg border px-3 py-2 text-base"
            style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}
          />
          <button
            type="submit"
            className="self-start rounded-lg border px-3 py-1.5 text-sm"
            style={{ borderColor: "var(--color-border)" }}
          >
            Save notes
          </button>
        </form>
      </Card>
    </div>
  );
}

function formatSource(source: string): string {
  return source
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
