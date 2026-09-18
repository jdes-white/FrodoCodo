-- Task 6C: final pre-live data-minimisation hardening.

-- currentBalance/availableBalance were kept under the (incorrect, on
-- review) assumption that FrodoCodo's "how much do we have left" question
-- needed a bank account balance. It doesn't -- that question is answered
-- by budget-remaining (apps/web/lib/budgetSnapshot.ts's allocation-minus-
-- spend calculation), which never reads either column, and nothing else
-- in this codebase reads them either. Per the audit's own minimisation
-- principle, a field with no currently-required reader is removed rather
-- than kept "just in case" the provider supplies it.
ALTER TABLE "Account" DROP COLUMN "currentBalance";
ALTER TABLE "Account" DROP COLUMN "availableBalance";

-- A provider's own explicit declaration that one transaction reverses/
-- links to another (Task 6C reversal-detection hardening, tier-1
-- evidence) -- structurally identical in sensitivity to
-- providerTransactionId itself (a single opaque ID). Nullable and
-- currently unpopulated by any source; every existing row backfills to
-- NULL.
ALTER TABLE "Transaction" ADD COLUMN "reversalOfProviderTransactionId" TEXT;
