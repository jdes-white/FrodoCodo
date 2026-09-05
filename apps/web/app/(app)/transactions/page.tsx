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
      <TransactionList transactions={transactions} />
    </div>
  );
}
