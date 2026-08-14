import { requireSession } from "@/lib/session";
import { listTransactions } from "@/lib/transactions";
import { listCategoriesWithBuckets, listAccounts } from "@/lib/categories";
import { TransactionList } from "@/components/TransactionList";
import { TransactionFiltersForm } from "@/components/TransactionFiltersForm";

interface SearchParams {
  categoryId?: string;
  accountId?: string;
  merchantQuery?: string;
  needsReviewOnly?: string;
}

export default async function TransactionsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const session = await requireSession();

  const [transactions, categories, accounts] = await Promise.all([
    listTransactions(session.householdId, {
      categoryId: params.categoryId || undefined,
      accountId: params.accountId || undefined,
      merchantQuery: params.merchantQuery || undefined,
      needsReviewOnly: params.needsReviewOnly === "1",
      limit: 100,
    }),
    listCategoriesWithBuckets(session.householdId),
    listAccounts(session.householdId),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold">Transactions</h1>
      <TransactionFiltersForm categories={categories} accounts={accounts} current={params} />
      <TransactionList transactions={transactions} />
    </div>
  );
}
