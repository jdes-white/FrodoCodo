import type { AccountType, TransactionDirection, TransactionStatus } from "@frodocodo/shared";
import { toMoney, type Money, type MoneyInput } from "@frodocodo/shared";

/**
 * Task 6B: the ONE sanctioned path from any transaction-producing source's
 * shape into FrodoCodo's permanent storage.
 *
 * Every future source (a Basiq/CDR sync, a CSV import, an OCR'd screenshot
 * import) returns transactions in its own shape — a CDR response can carry
 * merchant location metadata, biller codes, or fragments of banking-identity
 * data that were never requested but arrive anyway (see
 * docs/banking-data-minimisation-audit.md §3); a CSV row is whatever
 * columns the household's bank exports; a screenshot import is whatever an
 * OCR pass extracts. None of that is safe to spread directly into a
 * `prisma.transaction.create({ data: ... })` call.
 *
 * `toIngestibleTransactionFields` is the choke point: it reads exactly the
 * fields listed on `NormalizedTransactionInput` and returns exactly the
 * fields listed on `IngestibleTransactionFields` — nothing else can cross
 * into what gets persisted, even if the source object handed to a caller
 * has extra properties on it (a raw payload, a masked account number, a
 * customer name). Every ingestion call site (apps/worker/src/syncConnection.ts,
 * packages/db/src/seedHousehold.ts, and any future CSV/screenshot importer)
 * must build a `NormalizedTransactionInput` from its own source shape first
 * and then call this function — never construct the Prisma `data` object by
 * hand from the source object directly.
 *
 * The downstream categorisation/budgeting engine (packages/ledger's
 * classification, transfer, reversal, and refund modules) operates purely
 * on `IngestibleTransactionFields`-shaped data plus the caller's own
 * account/household context — it has no reason to know or care which
 * source produced a transaction. `sourceType` exists only for provenance
 * (e.g. a future "imported from CSV" badge) and future dedupe heuristics
 * (see dedupe.ts's documented cross-source boundary).
 */

export type IngestionSourceType = "PROVIDER_SYNC" | "CSV_IMPORT" | "SCREENSHOT_IMPORT";

export interface NormalizedTransactionInput {
  /** Opaque provider/source account identifier — never a bank account number. */
  sourceAccountId: string;
  /** The source's own stable transaction ID, when it has one (nullable — a CSV/screenshot row usually won't). */
  sourceTransactionId: string | null;
  transactionDate: string; // YYYY-MM-DD
  postingDate: string | null;
  amount: MoneyInput; // positive magnitude
  direction: TransactionDirection;
  status: TransactionStatus;
  /** The source's own transaction description/merchant text, before FrodoCodo's own merchant normalization runs. */
  description: string;
  sourceType: IngestionSourceType;
  /**
   * A source's own explicit declaration that this transaction reverses/
   * links to another one, by that other transaction's stable source ID
   * (Task 6C reversal-detection hardening, tier-1 evidence — see
   * reversalDetection.ts). Omit/null when the source doesn't supply one;
   * never guessed or derived.
   */
  reversalOfSourceTransactionId?: string | null;
}

/**
 * Exactly what's allowed to reach `prisma.transaction.create`/`createMany`
 * from ingestion. Deliberately excludes anything resembling a raw payload,
 * account-identity data, or source-specific metadata not in this list.
 */
export interface IngestibleTransactionFields {
  providerTransactionId: string | null;
  transactionDate: string;
  postingDate: string | null;
  amount: Money;
  direction: TransactionDirection;
  status: TransactionStatus;
  originalDescription: string;
  sourceType: IngestionSourceType;
  reversalOfProviderTransactionId: string | null;
}

export function toIngestibleTransactionFields(input: NormalizedTransactionInput): IngestibleTransactionFields {
  return {
    providerTransactionId: input.sourceTransactionId,
    transactionDate: input.transactionDate,
    postingDate: input.postingDate,
    amount: toMoney(input.amount),
    direction: input.direction,
    status: input.status,
    originalDescription: input.description,
    sourceType: input.sourceType,
    reversalOfProviderTransactionId: input.reversalOfSourceTransactionId ?? null,
  };
}

/**
 * Task 6C: the account-side counterpart of `toIngestibleTransactionFields`
 * — the only allow-listed path from a source's account shape into what
 * FrodoCodo persists. Deliberately excludes balances
 * (`currentBalance`/`availableBalance` — no currently-required feature
 * reads a bank balance, see `docs/banking-data-minimisation-audit.md`),
 * the provider's own account nickname/display name (a real aggregator
 * response can embed a masked-account-number fragment there — the
 * household-facing label is always a separately-derived alias, see
 * `accountAlias.ts`, never provider data), and any account
 * number/BSB/holder-identity field a source might return.
 */
export interface NormalizedAccountInput {
  /** Opaque provider/source account identifier — never a bank account number. */
  sourceAccountId: string;
  accountType: AccountType;
  currency: string;
}

export interface IngestibleAccountFields {
  providerAccountId: string;
  accountType: AccountType;
  currency: string;
}

export function toIngestibleAccountFields(input: NormalizedAccountInput): IngestibleAccountFields {
  return {
    providerAccountId: input.sourceAccountId,
    accountType: input.accountType,
    currency: input.currency,
  };
}
