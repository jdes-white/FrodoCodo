-- Task 6B: privacy-first transaction ingestion architecture.
-- Implements the Task 6A audit's data-minimisation decisions. No existing
-- row's meaningful data is lost -- every change below either renames a
-- column (preserving its current value) or drops/adds columns that were
-- either unused or default-backfillable.

-- Account.displayName was populated directly from whatever nickname
-- string a provider returned. A real CDR/aggregator response can embed a
-- masked-account-number fragment there (e.g. "Complete Access ...1234"),
-- which is exactly the banking-identity fragment this product must not
-- persist (docs/banking-data-minimisation-audit.md). Renaming (never
-- dropping+recreating) preserves every existing account's current value
-- untouched -- existing demo/dev data keeps working -- while the column's
-- *meaning* going forward is a FrodoCodo/household-chosen alias derived
-- from the institution's short name, never the provider's raw nickname.
ALTER TABLE "Account" RENAME COLUMN "displayName" TO "alias";

-- Transaction.rawProviderPayload (encrypted per security audit finding H3)
-- is removed entirely per the Task 6A decision: data FrodoCodo never
-- retains cannot later leak, which is a stronger guarantee than encrypting
-- it at rest. Nothing in the ingestion path writes to this column as of
-- this change (apps/worker/src/syncConnection.ts, packages/db/src/seedHousehold.ts).
ALTER TABLE "Transaction" DROP COLUMN "rawProviderPayload";

-- institutionTransactionRef was never written or read anywhere in the
-- codebase -- dead schema surface implying a second provider-supplied
-- transaction reference beyond providerTransactionId. Removed as part of
-- the minimisation pass rather than left as an undocumented, unused field.
ALTER TABLE "Transaction" DROP COLUMN "institutionTransactionRef";

-- Lets the ledger distinguish a live provider sync from a future CSV or
-- screenshot import (packages/ledger/src/ingestion.ts) without the
-- categorisation/budgeting engine needing to know or care which. Every
-- existing row defaults to PROVIDER_SYNC, which is accurate for all of
-- them -- there is no other ingestion path in this codebase yet.
CREATE TYPE "TransactionSourceType" AS ENUM ('PROVIDER_SYNC', 'CSV_IMPORT', 'SCREENSHOT_IMPORT');
ALTER TABLE "Transaction" ADD COLUMN "sourceType" "TransactionSourceType" NOT NULL DEFAULT 'PROVIDER_SYNC';

-- Task 6A's specific gap: a same-account, equal-and-opposite card reversal
-- was not distinguished from a genuine independent purchase or a
-- merchant-initiated refund. See packages/ledger/src/reversalDetection.ts.
ALTER TABLE "Transaction" ADD COLUMN "isReversal" BOOLEAN NOT NULL DEFAULT false;
