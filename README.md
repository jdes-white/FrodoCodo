# FrodoCodo

A household financial operating system — the calm, always-current answer to
*"Where do we stand against budget, right now, and why?"*

Version 1 focuses on budgeting and spending control (Stage 1 of the product's
four-stage roadmap: Control → Surplus → Goals → Wealth). See
[`docs/product-decisions.md`](docs/product-decisions.md) for the product
principles this build is anchored to, and [`CLAUDE.md`](CLAUDE.md) for the
engineering rules future changes must preserve.

## What's here

A pnpm monorepo:

```
apps/
  web/        Next.js 15 app — dashboard, transactions, insights, plan, settings, auth
  worker/     Background sync + insight-generation process
packages/
  domain/     Budget engine: periods, pacing, projections, scenario modelling, insight detectors
  ledger/     Merchant normalization, dedup, transfer/refund reconciliation, categorisation
  providers/  FinancialDataProvider interface + MockProvider (synthetic CBA/Virgin Money/Amex data)
  ai/         FinancialIntelligenceService — context fact sheet, model gateway, response validation
  db/         Prisma schema, migrations, seed script
  shared/     Money (decimal.js) and calendar-date utilities used by every package above
```

`domain`, `ledger`, `providers`, `ai`, and `shared` have zero dependency on
Next.js, Prisma, or any database — every financial calculation is a pure,
independently unit-tested function. `apps/web` and `apps/worker` are the only
places that touch a database or render UI.

## Quick start

Requires Node 20+, pnpm, and a local PostgreSQL 16 (or `docker compose up -d
postgres` if you have Docker).

```bash
pnpm install
cp .env.example .env            # then set DATABASE_URL / AUTH_SECRET
cp .env packages/db/.env        # prisma CLI reads .env from its own package dir
cp .env apps/web/.env
cp .env apps/worker/.env

pnpm --filter @frodocodo/db exec prisma migrate dev --name init
pnpm db:seed                    # seeds a demo household with synthetic transactions

pnpm dev                        # apps/web on http://localhost:3000
pnpm dev:worker                 # apps/worker, in a second terminal (optional for local dev)
```

Demo logins (created by the seed script — see its output, or
`packages/db/prisma/seed.ts`):

- Admin: `admin@frodocodo.household` / `frodocodo-demo`
- Household member: `member@frodocodo.household` / `frodocodo-demo`

No real bank credentials or Anthropic API key are required to run the full
product — see [AI](#ai) and [Financial data](#financial-data) below.

## Testing

```bash
pnpm test              # all unit tests (packages/*) — 114 tests, zero DB required
pnpm --filter @frodocodo/web test:e2e   # Playwright E2E against a running dev server + seeded DB
pnpm typecheck          # every package/app
```

See [`docs/test-strategy.md`](docs/test-strategy.md) for what's covered and why.

## Deployment

The app is packaged as a single Docker image (root `Dockerfile`) intended for
Render, running as a conventional long-lived Node process against the
existing Neon Postgres database — no serverless packaging involved. See
[`docs/deployment.md`](docs/deployment.md) for the architecture, environment
variables, health checks, and local Docker validation steps. An earlier
Vercel deployment was tried and deliberately abandoned; see that doc before
considering Vercel again.

## Financial data

This repo never touches real household financial data. `packages/providers`
implements the `FinancialDataProvider` interface once and ships one adapter:
`MockProvider`, which generates realistic, deterministic CBA/Virgin
Money/Amex-shaped synthetic transactions (income, mortgage, groceries, fuel,
dining, subscriptions, credit-card repayments, transfers, refunds, pending
transactions, and deliberately ambiguous merchants for the review queue).

Wiring a real Australian CDR-accredited aggregator (Basiq is the
recommendation — see [`docs/provider-integration.md`](docs/provider-integration.md))
is a config change: implement `FinancialDataProvider`, point
`FINANCIAL_PROVIDER` at it, done. The budgeting engine never talks to a
provider-specific schema.

## AI

`AI_PROVIDER=stub` (the default) runs the AI coach and insight narratives off
a deterministic template — no LLM credentials needed, and the dashboard is
never dependent on an external AI provider being reachable. Set
`AI_PROVIDER=anthropic` and `ANTHROPIC_API_KEY` to switch the same
`FinancialIntelligenceService` over to real Claude-generated narratives. See
[`docs/ai-architecture.md`](docs/ai-architecture.md).

## Documentation

- [`docs/architecture.md`](docs/architecture.md) — layered architecture, tech stack, reasoning
- [`docs/data-model.md`](docs/data-model.md) — domain model and key relationships
- [`docs/financial-calculation-rules.md`](docs/financial-calculation-rules.md) — pacing/projection math, transfer & refund handling
- [`docs/provider-integration.md`](docs/provider-integration.md) — CDR landscape, target-product verification, Basiq integration notes
- [`docs/ai-architecture.md`](docs/ai-architecture.md) — context generation, model gateway, response validation
- [`docs/security-privacy.md`](docs/security-privacy.md) — auth, encryption, consent, data flows
- [`docs/deployment.md`](docs/deployment.md) — environments, hosting recommendation, env vars
- [`docs/test-strategy.md`](docs/test-strategy.md) — what's tested and where
- [`docs/product-decisions.md`](docs/product-decisions.md) — decision log
