import Link from "next/link";
import { formatAUD } from "@frodocodo/shared";
import { fromPrismaDecimal } from "@/lib/decimal";

interface TransactionListItem {
  id: string;
  transactionDate: Date;
  originalDescription: string;
  amount: unknown; // Prisma.Decimal
  direction: "DEBIT" | "CREDIT";
  status: "PENDING" | "POSTED";
  merchant: { normalizedName: string } | null;
  category: { name: string; bucket: { name: string } } | null;
}

export function TransactionList({ transactions }: { transactions: TransactionListItem[] }) {
  if (transactions.length === 0) {
    return (
      <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
        No transactions yet.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      {transactions.map((tx) => (
        <Link
          key={tx.id}
          href={`/transactions/${tx.id}`}
          className="flex items-center justify-between rounded-xl border px-4 py-3"
          style={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}
        >
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{tx.merchant?.normalizedName ?? tx.originalDescription}</p>
            <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
              {formatDate(tx.transactionDate)}
              {tx.category ? ` · ${tx.category.name}` : " · Needs review"}
              {tx.status === "PENDING" ? " · Pending" : ""}
            </p>
          </div>
          <p className="shrink-0 pl-3 text-sm font-medium" style={{ color: tx.direction === "CREDIT" ? "var(--status-ahead)" : undefined }}>
            {tx.direction === "CREDIT" ? "+" : "-"}
            {formatAUD(fromPrismaDecimal(tx.amount))}
          </p>
        </Link>
      ))}
    </div>
  );
}

function formatDate(date: Date): string {
  return new Date(date).toLocaleDateString("en-AU", { day: "numeric", month: "short" });
}
