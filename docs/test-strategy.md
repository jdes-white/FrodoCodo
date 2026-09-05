# Test strategy

## Unit tests (114 tests, `pnpm test`, no database required)

All in `packages/*/src/__tests__/`, run via Vitest. These packages have zero
I/O — every test is deterministic inputs → asserted outputs.

| Package | Tests | Covers |
|---|---|---|
| `shared` | 25 | Money arithmetic/formatting, calendar-date math (including the leap-year and month-rollover edge cases) |
| `domain` | 35 | Budget period boundaries (all 4 cycle types), pacing/variance/projection math (including the fixed-commitment step curve), scenario modelling, insight detectors |
| `ledger` | 30 | Merchant normalization, dedup (incl. pending→posted transitions, cross-account isolation), transfer/CC-repayment detection, refund matching, categorisation precedence, learned-mapping derivation |
| `providers` | 15 | Synthetic dataset generation (determinism, realistic patterns, positive-only amounts), `MockProvider` lifecycle, **cross-process connection reconstruction** (a real bug this test suite caught — see below) |
| `ai` | 9 | Fact-sheet figure extraction, AI response validation (accepts known figures, rejects invented ones, rejects malformed schema, falls back on provider error) |

Every one of the spec's explicitly-required correctness scenarios (§52) has
a direct test:

- Budget arithmetic & period boundaries — `domain/budgetPeriod.test.ts`, `pacing.test.ts`
- Pacing calculations & projections — `domain/pacing.test.ts`
- Transaction deduplication — `ledger/dedupe.test.ts`
- Pending → posted transitions — `ledger/dedupe.test.ts`
- Credit-card repayment detection — `ledger/transferDetection.test.ts`
- Inter-account transfers — `ledger/transferDetection.test.ts`
- Refunds — `ledger/refundMatching.test.ts`
- Merchant rules & categorisation precedence — `ledger/classification.test.ts`
- AI schema validation — `ai/financialIntelligenceService.test.ts`

Permissions and household isolation are enforced structurally (every query
scoped by `householdId`, admin actions gated by `requireAdmin()`) rather
than covered by a dedicated unit test package — see `docs/security-privacy.md`
and `CLAUDE.md` rule 10/11. Adding an integration test for this (two
households, assert zero cross-visibility) is a natural next addition once a
test database fixture exists for `apps/web`.

## A real bug this caught

`packages/providers/src/__tests__/mockProvider.test.ts` includes a
regression test ("reconstructs a connection created by a different
process/instance from its persisted ID") added after the worker failed
against a freshly-seeded database with "Unknown mock connection" — the seed
script and the worker are separate Node processes, each with their own
in-memory `MockProvider`, and the original implementation only remembered
connections it had personally initiated. Fixed by encoding the institution
into the connection ID so any process can reconstruct state (see `CLAUDE.md`).
This is exactly the kind of bug that only surfaces when you actually run the
thing end-to-end rather than only unit-testing in isolation — see the E2E
section below.

`packages/shared/src/__tests__/date.test.ts` similarly caught an inverted
upper-bound comparison in `clampDate` before it was ever called from
production code.

## End-to-end (Playwright, `apps/web/e2e/`)

`critical-flow.spec.ts` exercises the actual product journey against a real
running server and a seeded Postgres database (not mocked): login → dashboard
shows the primary budget position and per-bucket status → drill into a
bucket → drill into a transaction → reclassify it via the review-queue flow
→ confirm it leaves "needs review". A second test exercises the AI
conversational interface (§24) end-to-end against the stub gateway.

Run it with the dev server up and a freshly seeded database:

```bash
pnpm db:seed
pnpm dev            # separate terminal
pnpm --filter @frodocodo/web test:e2e
```

"Connect/import" (§52's first step) is exercised by the seed script itself,
which runs transactions through the exact same `MockProvider` →
`packages/ledger` pipeline the worker uses in production — it is not a
hand-authored fixture. See `packages/db/prisma/seed.ts`.

## What's verified but not automated

- Visual/responsive design was checked manually via Playwright screenshots
  at mobile (390×844) and desktop (1280×900) viewports during development —
  not asserted in CI. A visual regression tool (Percy, Chromatic) would be
  the natural next step if the UI grows past what a human can eyeball on
  each change.
- Idempotent re-sync (running the worker twice produces zero new/updated
  transactions) was verified manually against the seeded database during
  development; it is implied by the dedup unit tests but not currently
  asserted as its own worker-level test (would need a test database fixture
  for `apps/worker`, which doesn't exist yet).
