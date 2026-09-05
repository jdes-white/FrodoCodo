import { notFound } from "next/navigation";
import Link from "next/link";
import { formatAUD } from "@frodocodo/shared";
import { requireSession } from "@/lib/session";
import { getTransactionDetail } from "@/lib/transactions";
import { listCategoriesWithBuckets } from "@/lib/categories";
import { fromPrismaDecimal } from "@/lib/decimal";
import {
  reclassifyTransaction,
  setExcludedFromBudget,
  markAsTransfer,
  updateNotes,
  keepAsSeparateTransaction,
  markAsDuplicateTransaction,
  clearExtractionReview,
  confirmAsGenuineSpending,
} from "./actions";
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
          <dd className="text-right">{transaction.account.alias}</dd>
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

      {transaction.possibleDuplicateOf && (
        <Card as="section">
          <h2 className="mb-2 text-sm font-medium" style={{ color: "var(--status-behind)" }}>
            Possible duplicate
          </h2>
          <p className="mb-3 text-sm" style={{ color: "var(--color-text-muted)" }}>
            This looks similar to another transaction:{" "}
            <span className="font-medium">
              {transaction.possibleDuplicateOf.merchant?.normalizedName ?? transaction.possibleDuplicateOf.originalDescription}
            </span>{" "}
            for {formatAUD(fromPrismaDecimal(transaction.possibleDuplicateOf.amount))} on{" "}
            {new Date(transaction.possibleDuplicateOf.transactionDate).toLocaleDateString("en-AU")}. Is this the same
            transaction, or two separate ones?
          </p>
          <div className="flex flex-wrap gap-2">
            <form action={keepAsSeparateTransaction}>
              <input type="hidden" name="transactionId" value={transaction.id} />
              <button type="submit" className="rounded-lg border px-3 py-1.5 text-sm" style={{ borderColor: "var(--color-border)" }}>
                These are separate
              </button>
            </form>
            <form action={markAsDuplicateTransaction}>
              <input type="hidden" name="transactionId" value={transaction.id} />
              <button
                type="submit"
                className="rounded-lg px-3 py-1.5 text-sm font-medium text-white"
                style={{ background: "var(--status-behind)" }}
              >
                This is a duplicate — remove it
              </button>
            </form>
          </div>
        </Card>
      )}

      {transaction.needsFinancialMovementReview && (
        <Card as="section">
          <h2 className="mb-2 text-sm font-medium" style={{ color: "var(--status-behind)" }}>
            Might not be spending
          </h2>
          <p className="mb-3 text-sm" style={{ color: "var(--color-text-muted)" }}>
            This looks like it could be a transfer between your own accounts rather than a purchase. Is it a transfer,
            or genuine spending?
          </p>
          <div className="flex flex-wrap gap-2">
            <form action={markAsTransfer}>
              <input type="hidden" name="transactionId" value={transaction.id} />
              <button type="submit" className="rounded-lg border px-3 py-1.5 text-sm" style={{ borderColor: "var(--color-border)" }}>
                It&apos;s a transfer
              </button>
            </form>
            <form action={confirmAsGenuineSpending}>
              <input type="hidden" name="transactionId" value={transaction.id} />
              <button
                type="submit"
                className="rounded-lg px-3 py-1.5 text-sm font-medium text-white"
                style={{ background: "var(--color-accent)" }}
              >
                It&apos;s genuine spending
              </button>
            </form>
          </div>
        </Card>
      )}

      {transaction.needsExtractionReview && (
        <Card as="section">
          <h2 className="mb-2 text-sm font-medium" style={{ color: "var(--status-behind)" }}>
            Low-confidence read
          </h2>
          <p className="mb-3 text-sm" style={{ color: "var(--color-text-muted)" }}>
            This transaction was imported from a screenshot the vision model wasn&apos;t fully confident about — double check
            the date, description, and amount above look right.
          </p>
          <form action={clearExtractionReview}>
            <input type="hidden" name="transactionId" value={transaction.id} />
            <button type="submit" className="rounded-lg border px-3 py-1.5 text-sm" style={{ borderColor: "var(--color-border)" }}>
              This looks correct
            </button>
          </form>
        </Card>
      )}

      <Card as="section">
        <h2 className="mb-3 text-sm font-medium">Reclassify</h2>
        {!transaction.categoryId && transaction.suggestedCategory && (
          <p className="mb-3 text-xs" style={{ color: "var(--color-text-muted)" }}>
            Needs review — best guess is{" "}
            <span className="font-medium">
              {transaction.suggestedCategory.bucket.name} · {transaction.suggestedCategory.name}
            </span>
            {transaction.suggestedCategorySource && typeof transaction.suggestedCategoryConfidence === "number"
              ? ` (${formatSource(transaction.suggestedCategorySource)}, ${Math.round(transaction.suggestedCategoryConfidence * 100)}% confidence)`
              : ""}
            . Pre-selected below — confirm or change it, then save.
          </p>
        )}
        <form action={reclassifyTransaction} className="flex flex-col gap-3">
          <input type="hidden" name="transactionId" value={transaction.id} />
          <select
            name="categoryId"
            defaultValue={transaction.categoryId ?? transaction.suggestedCategoryId ?? ""}
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
