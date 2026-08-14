# Financial calculation rules

Every rule below is implemented as a pure function in `packages/domain` or
`packages/ledger` and covered by a unit test in the same package. This
document explains *why* each rule exists; the code is the source of truth
for *how*.

## Money representation

All money is `decimal.js` `Decimal`, never a JS `number`. `Transaction.amount`
is always stored as a **positive magnitude** with a separate `direction`
(`DEBIT`/`CREDIT`) field — this avoids an entire class of sign-error bugs
(e.g. summing debits and credits together and getting a number that's
correct-looking but wrong).

## Budget periods (§15)

`resolveBudgetPeriod(config, referenceDate)` (`packages/domain/src/budgetPeriod.ts`)
supports four cycle types:

- `CALENDAR_MONTH` — 1st to last day of the month.
- `ANCHORED_MONTHLY` — cycles from a configured day-of-month (e.g. payday on
  the 15th) to the day before that day next month. An anchor day beyond a
  short month's length (e.g. 31 in February) clamps to that month's last day.
- `FORTNIGHTLY` — 14-day cycles from a household-configured epoch date.
- `CUSTOM` — arbitrary cycle length from an epoch date.

The household's cycle should match how income actually arrives, not default
to the calendar — this is set once in Settings, not hardcoded.

## Pacing (§16) — the core of the product

`calculatePacing(input)` (`packages/domain/src/pacing.ts`) computes, for one
category/bucket/total:

- **`expectedSpendToDate`**: for `FLEXIBLE`/`SAVINGS` categories, a linear
  function of elapsed days (`allocation × daysElapsed / totalDays`). For
  `FIXED_COMMITMENT` categories, a **step function**: 0 before the known due
  date (`FixedCommitment.expectedDueDayOfMonth`), the full allocation on or
  after it. A $2,400 mortgage payment due on the 3rd shouldn't read as "37%
  behind pace" on the 5th just because 1/8th of the month elapsed with 100%
  of the mortgage spent — it's not behind, it's *paid*.
- **`variance`** = `spentToDate - expectedSpendToDate`. Positive means
  spending is running ahead of the expected pace (bad); negative means under
  pace (good). This sign convention is internal — the UI flips it into
  "ahead of pace" / "behind pace" language.
- **`pacingStatus`**: `AHEAD` / `ON_TRACK` / `BEHIND`, using a configurable
  threshold band (default 5% of allocation) around zero variance, so
  1%-off-pace doesn't read as a status change.
- **`spendVelocityPerDay`**: from a trailing window (default 7 days) when
  supplied, else a to-date average. Used for the projection, not for
  `expectedSpendToDate` (those are deliberately different — expected pace is
  "what the budget implies", velocity is "what's actually happening lately").
- **`projectedEndOfPeriod`**: `spentToDate + velocity × daysRemaining` for
  flexible categories. For `FIXED_COMMITMENT`, it's just the allocation (or
  the actual spent amount if that's already higher — e.g. an insurance
  premium increase) rather than a velocity extrapolation, since a fixed cost
  doesn't "keep happening" for the rest of the period once paid.

## Transfers & credit-card repayments (§38)

`detectTransferPairs` (`packages/ledger/src/transferDetection.ts`) matches a
DEBIT in one household account against a CREDIT of the identical amount in
another household account, within a 3-day window. The account-type of the
credit leg distinguishes `CREDIT_CARD_REPAYMENT` from a plain
`INTER_ACCOUNT_TRANSFER`. Both get `isTransfer: true` +
`isExcludedFromBudget: true`, so a credit-card purchase is counted as
spending exactly once (when it happens on the card) and the later repayment
from the transaction account is never counted again.

This is only ever run against transactions from the household's *own*
accounts (never a merchant's), which is what keeps the amount+window
heuristic safe in practice — an external purchase has no "other leg" to
match against. Users can always override a false match (§32).

## Refunds (§39)

`detectRefunds` (`packages/ledger/src/refundMatching.ts`) matches a CREDIT
to the most recent prior DEBIT on the *same account* with the *same
merchant* and an amount that's `>=` the refund (partial refunds are
supported; a refund can never exceed its original purchase), within a
90-day window. The refund transaction's `categoryId` is set to match the
original purchase's — so the budget reflects the net economic effect (a
$200 purchase refunded $50 nets to $150 spent in that category), not an
unexplained credit.

## Deduplication & pending→posted (§10, §40)

`resolveDedupe` (`packages/ledger/src/dedupe.ts`) is the single place that
decides whether an incoming transaction from a sync is new, a duplicate, or
a pending transaction that's now posted:

1. Exact match on `(accountId, providerTransactionId)` — if found and the
   existing row is `PENDING` while the incoming one is `POSTED`, update the
   existing row in place (never insert a second row). If both are `POSTED`,
   it's a re-sync no-op.
2. If no exact match and the incoming transaction is `POSTED`: look for a
   `PENDING` row on the same account with the same amount and direction
   within a 5-day window — some providers reissue a new transaction ID when
   a pending transaction posts, and this heuristic catches that without
   inserting a duplicate.
3. Otherwise, insert.

## Categorisation precedence (§11)

Strict order, first match wins (`packages/ledger/src/classification.ts`):

1. **Household rule** (`MerchantRule`) — confidence 1.0, always wins.
2. **Learned mapping** (`Merchant.defaultCategoryId`) — set once the
   household has corrected a merchant to the same category ≥3 times without
   an explicit rule (`deriveLearnedMapping`).
3. **Provider enrichment** — the aggregator's own merchant/category data,
   when available and mapped to an internal category.
4. **AI suggestion** — only consulted if 1-3 produced nothing confident
   enough; also gated by the same confidence threshold (default 0.6).
5. **Review queue** — if nothing clears the threshold, the transaction is
   left uncategorized (`categoryId: null`) rather than guessed, and appears
   in the "Needs review" filter on the Transactions page.

## Scenario modelling (§27)

`applyScenario` (`packages/domain/src/scenario.ts`) applies a list of
adjustments (reduce by amount, reduce by percent, set allocation, remove)
to a baseline set of category allocations and returns the per-line and net
change. It's pure and runs client-side in the Plan page's "What if?" tool —
the AI layer may narrate a scenario's result but never computes it.
