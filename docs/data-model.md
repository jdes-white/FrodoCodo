# Data model

Full source of truth is `packages/db/prisma/schema.prisma`. This is a guided
tour of the relationships that matter for correctness.

## Household & access

```
User ──< HouseholdMember >── Household
```

`HouseholdMember.role` (`ADMIN` | `MEMBER`) is the only permission axis (§5).
Every query in `apps/web/lib` scopes through `householdId` — there is no
cross-household read path, and no separate "admin product" — both users see
the same numbers, differing only in which mutations they're allowed to make
(enforced via `requireAdmin()` in `apps/web/lib/session.ts`).

## Financial ingestion

```
Household ──< FinancialConnection >── FinancialInstitution
                    │
                    └──< Account ──< Transaction
                                        │
                    SyncRun >───────────┘ (one run produces many transactions)
```

`FinancialConnection.connectionMethod` (`CDR` | `CREDENTIAL_BASED` | `MANUAL`)
records *how* an institution is reachable, disclosed honestly to the
household in Settings — see `docs/provider-integration.md` for why Amex is
`CREDENTIAL_BASED` today and CBA/Virgin Money are `CDR`.

## Canonical transaction (§9)

`Transaction` carries the normalized fields the app uses everywhere
(`amount` + `direction`, always a positive `Decimal` magnitude plus
DEBIT/CREDIT rather than a signed number, `normalizedMerchantId`,
`categoryId`) — normalization never destroys the original description
(`originalDescription` is always kept). There is deliberately no raw-
provider-payload column: Task 6B's data-minimisation pass removed it once
real transaction ingestion was designed for, on the principle that data
FrodoCodo never retains cannot later leak — see
`docs/banking-data-minimisation-audit.md` and
`packages/ledger/src/ingestion.ts`'s explicit field allow-list, which is
the only path any source's transaction data can take into this table.

Integrity fields:

- `isTransfer` + `isExcludedFromBudget` + `transferGroupId` +
  `counterpartTransactionId` — set by `detectTransferPairs`
  (`packages/ledger`) to keep credit-card repayments and inter-account
  transfers out of spend totals (§38).
- `refundOfTransactionId` — set by `detectRefunds` so a refund nets against
  its original purchase's category rather than reading as new income (§39).
- `providerTransactionId` (nullable, unique per account) — the dedup key;
  `resolveDedupe` (`packages/ledger`) also handles the case where a pending
  transaction's provider ID changes once it posts (§10, §40).
- `classificationSource` (`RULE` | `LEARNED_MAPPING` | `PROVIDER` | `AI` |
  `USER` | `SYSTEM`) + `TransactionClassification` history rows — every
  category assignment is traceable to *why* (§31).

## Categorisation & rules

```
Merchant ──< MerchantRule >── Category ──< BudgetBucket
   │
   └──< Transaction (normalizedMerchantId)
```

`Merchant.defaultCategoryId` is the "learned mapping" layer (§11 Layer 2) —
set once a household has corrected the same merchant to the same category
repeatedly (`deriveLearnedMapping`, `packages/ledger`) without an explicit
rule existing. `MerchantRule` (§11 Layer 1, highest precedence) is created
explicitly, either by an admin or via the "always classify this way"
checkbox on a transaction correction (§12).

## Budget hierarchy (§13, §14)

```
BudgetBucket (headline, e.g. "Essentials")
   └── Category (detailed, e.g. "Groceries")
          ├── spendingType: FIXED_COMMITMENT | FLEXIBLE | SAVINGS
          └── BudgetAllocation (one per BudgetPeriod)

BudgetPeriod (start/end dates, type, bufferAmount, expectedIncome)
```

Both buckets and categories are household-configurable rows, not hardcoded
enums — the seeded defaults (Essentials / Lifestyle & Discretionary / Family
& Household / Savings & Goals) are just seed data. `Category.spendingType`
is what drives pacing behaviour: `FIXED_COMMITMENT` categories use a step
expected-spend curve keyed off `FixedCommitment.expectedDueDayOfMonth`
rather than linear pacing (§16) — see `docs/financial-calculation-rules.md`.

## Insights & AI

```
Insight ──< InsightEvidence >── Transaction
AIConversation ──< AIMessage
```

`Insight.dedupeKey` is a stable string (e.g.
`projected-overspend:2026-08_2026-08-31:bucketId`) so re-running the
detector engine upserts rather than duplicates. `AIMessage.contextSnapshot`
(Json, optional) can hold the fact sheet a given AI response was generated
from, for future "why did the AI say that" debugging.

## Audit

`AuditEvent` (`householdId`, `actorUserId`, `action`, `entityType`,
`entityId`, `metadata Json`) is written by every admin mutation
(`apps/web/lib/audit.ts`) — reclassification, exclusion, allocation edits,
account inclusion toggles, institution disconnection.
