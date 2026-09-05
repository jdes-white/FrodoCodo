# Architecture

## Layers

```
apps/web        Presentation + API (Next.js Route Handlers/Server Actions, thin)
apps/worker      Background sync + insight generation
   |
   v
packages/ai      Context generation, model gateway, response validation
packages/domain  Budget periods, pacing/projection, scenario modelling, insight detectors
packages/ledger  Merchant normalization, dedup, transfer/refund reconciliation, categorisation
packages/providers  FinancialDataProvider interface + adapters
   |
   v
packages/shared  Money (decimal.js) + calendar-date utilities
packages/db      Prisma schema, migrations, seed
```

`domain`, `ledger`, `providers`, `ai`, and `shared` have no dependency on a
database, a web framework, or each other in a way that would prevent
independent testing — every one of them is exercised by vitest with zero
I/O. `apps/web` and `apps/worker` are the only packages that touch Postgres,
and they call into the pure packages for every calculation rather than
reimplementing logic inline.

This split exists so a future dedicated mobile client (or a second web
frontend) could reuse `domain`/`ledger`/`ai` without touching business logic
— only `apps/web`'s presentation layer would need to be rebuilt.

## Why this stack

| Concern | Choice | Why |
|---|---|---|
| Frontend | Next.js 15 (App Router), React 19, TypeScript, Tailwind v4 | Server-rendered dashboard for a fast first paint (§3's five-second promise); mobile-first by default |
| API | Next.js Route Handlers + Server Actions, thin | Business logic stays in `domain`/`ledger`, not HTTP handlers |
| Database | PostgreSQL + Prisma | Relational integrity for a financial ledger is non-negotiable; Prisma gives typed queries and migration history from day one |
| Auth | Hand-rolled signed JWT session cookie (`jose` + `bcryptjs`) | Right-sized for a two-user household product — see `docs/product-decisions.md` for why this beats pulling in a full auth framework here |
| Background jobs | `apps/worker`, plain Node process, `setInterval` loop | No durable queue needed at single-instance household scale; swap for pg-boss/BullMQ if that changes (see `CLAUDE.md`) |
| Financial provider | `FinancialDataProvider` interface; `MockProvider` shipped, Basiq recommended for real integration | See `docs/provider-integration.md` |
| LLM | Anthropic Claude via `packages/ai`, server-only | Never called from the client; swappable via `ModelGateway` |
| Testing | Vitest (unit), Playwright (E2E) | Matches the emphasis on deterministic-logic tests over UI snapshot tests |

## Request flow: the dashboard

1. `apps/web/app/(app)/page.tsx` (server component) calls
   `getBudgetSnapshot(householdId)`.
2. That function (`apps/web/lib/budgetSnapshot.ts`) resolves the current
   budget period (`packages/domain`'s `resolveBudgetPeriod`), reads
   allocations and net category spend from Postgres, and calls
   `calculatePacing` (pure, `packages/domain`) once per category and again
   aggregated per bucket and household-wide.
3. The page renders directly from the returned `BudgetSnapshot` — no client-
   side fetch, no loading spinner for the primary number.
4. If the AI coach is asked a question (`Insights` page), the same snapshot
   is converted to a `FinancialFactSheet` (`apps/web/lib/factSheetBuilder.ts`)
   and handed to `FinancialIntelligenceService`, which is the only thing in
   the app that talks to Claude.

## Ingestion flow: sync

1. `apps/worker` calls `provider.syncTransactions(...)` (currently
   `MockProvider`; a real adapter would call Basiq here).
2. Each returned transaction goes through `packages/ledger`: normalize
   merchant → `resolveDedupe` against existing rows for that account →
   classify (`classifyDeterministic` + `resolveClassification`) → insert or
   update.
3. After the batch, `detectTransferPairs` and `detectRefunds` run across the
   household's transactions to reconcile credit-card repayments,
   inter-account transfers, and refunds (§38/§39).
4. `generateInsightsForHousehold` runs the deterministic detectors from
   `packages/domain` and upserts `Insight` rows.

The web app's dashboard never depends on this process being up — it always
reads the last-synced state directly from Postgres (§44).
