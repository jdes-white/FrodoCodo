import Link from "next/link";
import { requireSession } from "@/lib/session";
import { listTransactions } from "@/lib/transactions";
import { listCategoriesWithBuckets, listAccounts } from "@/lib/categories";
import { currentMonth, monthBounds } from "@/lib/monthRange";
import { withRouteTiming } from "@/lib/perf";
import { TransactionList } from "@/components/TransactionList";
import { TransactionFiltersForm } from "@/components/TransactionFiltersForm";
import { MonthStepper } from "@/components/MonthStepper";
import { PageHeader } from "@/components/PageHeader";

interface SearchParams {
  categoryId?: string;
  accountId?: string;
  merchantQuery?: string;
  needsReviewOnly?: string;
  importBatchId?: string;
  month?: string;
}

const MONTH_PATTERN = /^\d{4}-\d{2}$/;

export default async function TransactionsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const session = await requireSession();

  const needsReviewOnly = params.needsReviewOnly === "1";
  const importBatchId = params.importBatchId || undefined;
  const month = params.month && MONTH_PATTERN.test(params.month) ? params.month : currentMonth();
  // The review queue is about *what still needs attention*, not *what happened
  // this month* — an uncategorized transaction from an earlier month still
  // needs a category, so that view intentionally isn't month-constrained.
  // A single import batch is the same: its rows should all show regardless
  // of which calendar month they landed in.
  const { startDate, endDate } = needsReviewOnly || importBatchId ? {} : monthBounds(month);

  const [transactions, categories, accounts] = await withRouteTiming("/transactions", () =>
    Promise.all([
      listTransactions(session.householdId, {
        categoryId: params.categoryId || undefined,
        accountId: params.accountId || undefined,
        merchantQuery: params.merchantQuery || undefined,
        needsReviewOnly,
        importBatchId,
        startDate,
        endDate,
        limit: 150,
      }),
      listCategoriesWithBuckets(session.householdId),
      listAccounts(session.householdId),
    ]),
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <PageHeader title="Transactions" />
        <Link href="/import" className="shrink-0 text-sm font-medium" style={{ color: "var(--color-accent)" }}>
          Import from screenshots
        </Link>
      </div>
      <MonthStepper
        month={month}
        otherParams={{
          categoryId: params.categoryId,
          accountId: params.accountId,
          merchantQuery: params.merchantQuery,
          needsReviewOnly: params.needsReviewOnly,
        }}
      />
      <TransactionFiltersForm categories={categories} accounts={accounts} current={{ ...params, month }} />
      <TransactionList transactions={transactions} returnTo={buildReturnTo(params, month)} />
    </div>
  );
}

/**
 * Save/Back flow fix: the exact filtered list a household member drilled
 * into a transaction from — carried onto each detail link as `?from=` so
 * both "Back to transactions" and a successful reclassify Save return to
 * this same view (still checked "Needs review only", still on the same
 * month, etc.) instead of resetting to a bare, unfiltered `/transactions`.
 */
function buildReturnTo(params: SearchParams, month: string): string {
  const query = new URLSearchParams();
  if (params.categoryId) query.set("categoryId", params.categoryId);
  if (params.accountId) query.set("accountId", params.accountId);
  if (params.merchantQuery) query.set("merchantQuery", params.merchantQuery);
  if (params.needsReviewOnly) query.set("needsReviewOnly", params.needsReviewOnly);
  if (params.importBatchId) query.set("importBatchId", params.importBatchId);
  if (params.month) query.set("month", month);
  const qs = query.toString();
  return qs ? `/transactions?${qs}` : "/transactions";
}
