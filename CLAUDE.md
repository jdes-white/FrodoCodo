# CLAUDE.md

Engineering rules and product principles for anyone (human or Claude) working
on this repository. Read this before making changes — it encodes decisions
that were made deliberately and will look "wrong" out of context.

## What this product is

A household financial operating system, not an accounting ledger. V1 answers
exactly three questions, fast: *how much do we have left, where is it going,
are we on track.* Everything else is secondary. See
`docs/product-decisions.md` for the full reasoning and the original build
spec's non-negotiables — the short version is below.

## Non-negotiable engineering principles

1. **Financial calculations are deterministic.** Every number on screen
   traces back to a pure function in `packages/domain` or a direct database
   aggregate. Never let an LLM compute or restate a number it wasn't handed.
2. **LLMs explain; they never own the ledger.** `packages/ai`'s
   `FinancialIntelligenceService` validates every model response against the
   fact sheet it was given (`narrativeCitesOnlyKnownFigures` in
   `packages/ai/src/factSheet.ts`) and falls back to a deterministic template
   on any mismatch, schema failure, or provider error. If you add a new AI
   feature, it must go through this service, not a fresh model call.
3. **Money is always `Decimal` (decimal.js), never `number`.** Use `toMoney`/
   `MoneyInput` from `@frodocodo/shared`. A Prisma `Decimal` and our
   `decimal.js` `Decimal` can be different module instances depending on
   pnpm hoisting — always round-trip through `fromPrismaDecimal` (in
   `apps/web/lib/decimal.ts`) at the DB boundary rather than passing a Prisma
   Decimal straight into `toMoney`.
4. **Never double-count money moving between the household's own accounts.**
   Credit-card repayments and inter-account transfers are detected by
   `packages/ledger/src/transferDetection.ts` and marked
   `isTransfer + isExcludedFromBudget`. Any new query that sums "spend" must
   filter `isTransfer: false, isExcludedFromBudget: false` — see
   `apps/web/lib/budgetSnapshot.ts`'s `netSpendByCategory` for the pattern.
5. **Categorisation follows strict precedence**: household rule → learned
   mapping → provider enrichment → AI suggestion → review queue. This lives
   in `packages/ledger/src/classification.ts`
   (`classifyDeterministic`/`resolveClassification`) — don't reimplement it
   inline in a route handler or the worker.
6. **Users can always override automation**, and corrections should make the
   system smarter (`deriveLearnedMapping` in the same file, plus the
   "always classify this way" checkbox on the transaction detail page that
   creates a `MerchantRule`).
7. **The dashboard stays sparse.** Total → buckets → drill-down. Resist
   adding charts, tables, or AI chrome to the home screen — see §17/§46/§47
   of the original spec (`docs/product-decisions.md`) if tempted.
8. **AI is an enhancement, never a dependency for core operation.** The
   dashboard, transactions, budget, and Plan pages must render correctly
   with `AI_PROVIDER=stub` and with the Anthropic API unreachable.
9. **Financial provider integrations are replaceable adapters.** Everything
   outside `packages/providers` talks to the `FinancialDataProvider`
   interface (`packages/providers/src/types.ts`), never to a provider-
   specific shape. `MockProvider` is the only adapter wired today — see
   `docs/provider-integration.md` before adding a real one.
10. **Household data is isolated by `householdId` on every query.** There is
    no cross-household read path. If you add a new Prisma query, scope it
    through `connection: { householdId }` / `householdId` like every
    existing query does — don't rely on the caller having already filtered.
11. **Admin-only actions check `requireAdmin()`, not just `requireSession()`.**
    Budget allocation edits, account inclusion/exclusion, and institution
    disconnection are admin-only (§5) — both household users see the same
    numbers, but not the same controls.
12. **Audit important changes.** Reclassification, exclusion, transfer
    marking, allocation edits, and account/institution changes call
    `recordAuditEvent` (`apps/web/lib/audit.ts`). Keep doing this for new
    mutating actions — it's how "why did this total change" stays
    answerable (§31).

## Architecture rules

- **`vercel.json` at the repo root makes deployment independent of Vercel's
  Root Directory dashboard setting.** It explicitly sets `buildCommand`
  (`pnpm --filter @frodocodo/web run vercel-build`), `installCommand`, and
  `outputDirectory` (`apps/web/.next`), so the build works whether Root
  Directory is left blank (repo root) or set to `apps/web` — in the latter
  case Vercel's zero-config Next.js detection finds `apps/web/package.json`'s
  own `vercel-build` script directly and `vercel.json` is simply never read
  (Vercel only looks for it at the configured Root Directory). Keep both
  working if you touch either. See `docs/deployment.md`.
- **Prisma Client generates to its default location** (`node_modules/@prisma/client`,
  imported as `from "@prisma/client"` in `packages/db/src/index.ts`) — not
  a custom `output` path. This was changed specifically to deploy cleanly
  on Vercel: a custom output path outside `node_modules` is a known source
  of Next.js build-tracing failures on serverless platforms (the
  query-engine binary silently missing from the deployed function). Don't
  reintroduce a custom `output` in `packages/db/prisma/schema.prisma`
  without re-testing a real Vercel deploy. See `docs/deployment.md`.
- `packages/db/package.json`'s `"postinstall": "node scripts/generate.mjs"`
  is what makes the Prisma Client exist after `pnpm install` on a machine
  that's never run `prisma generate` manually (every CI/deploy environment,
  including Vercel). Don't remove it, and don't collapse it back to a bare
  `prisma generate` — the wrapper resolves the DB connection string across
  several possible env var names first (see next point).
- **Never assume the database connection string is named `DATABASE_URL`.**
  Depending on how a Postgres integration provisions the database, it can
  land under `POSTGRES_PRISMA_URL`, `POSTGRES_URL`, `DATABASE_URL_UNPOOLED`,
  or `POSTGRES_URL_NON_POOLING` instead. `packages/db/scripts/resolveDatabaseUrl.mjs`
  is the single source of truth for checking all of them, used by both
  build-time scripts (`packages/db/scripts/generate.mjs`,
  `apps/web/scripts/vercel-build.mjs`) and mirrored at runtime in
  `packages/db/src/index.ts` (passed to `PrismaClient` via `datasourceUrl`,
  not by mutating `process.env`). Any new script that needs to invoke the
  Prisma CLI directly must resolve the URL the same way rather than reading
  `process.env.DATABASE_URL` directly.
- **Seeding never runs automatically on deploy.** `apps/web/package.json`'s
  `vercel-build` script runs `prisma migrate deploy` (safe, idempotent) but
  deliberately not seeding — `seedDemoHousehold` (`packages/db/src/seedHousehold.ts`)
  wipes existing households first, so it only runs on demand via
  `POST /api/admin/seed` (token-gated by `SEED_TOKEN`). Never wire seeding
  into a build/deploy step.
- `packages/domain`, `packages/ledger`, `packages/providers`, `packages/ai`,
  and `packages/shared` must never import from `@frodocodo/db`, Next.js, or
  React. They're pure TypeScript, unit-tested in isolation. If a function
  needs a database, it belongs in `apps/web/lib` or `apps/worker/src`, not
  in one of these packages.
- Relative imports **within** a package use an explicit `.js` extension
  (`from "./pacing.js"`) — this is correct Node ESM and what `tsx`/`vitest`
  expect. `apps/web` imports are extensionless (Next.js/webpack convention).
  Don't "fix" one style into the other; see `apps/web/next.config.ts`'s
  `extensionAlias` webpack config for why both work.
- `MockProvider` connection IDs encode the institution
  (`mock::<institutionId>::<n>`) so any process (seed script, web request,
  worker) can reconstruct connection state from just the persisted ID — the
  in-memory `Map` is a cache, not the source of truth. If you change this
  encoding, update `parseInstitutionId` and `requireConnection` together.
- Budget periods roll over automatically (`ensureBudgetPeriod` in
  `apps/web/lib/budgetSnapshot.ts` copies the prior period's allocations
  when a new one starts) — the household should never have to rebuild its
  budget every month.

## Testing expectations

- Any change to `packages/domain` or `packages/ledger` needs a test in the
  same package covering the new behavior, following the existing pattern
  (deterministic inputs, assert on the `Decimal` via `.toNumber()`/`.equals`).
- Run `pnpm -r test && pnpm -r typecheck` before considering a change done.
- The Playwright suite (`apps/web/e2e/critical-flow.spec.ts`) exercises the
  actual product journey — login → dashboard → drill-down → reclassify → AI
  ask. It needs the dev server running against a freshly seeded database
  (`pnpm db:seed` first). Update it when that journey's UI changes shape.

## Known limitations worth knowing before you "fix" them

- Insight rows persisted by `apps/worker/src/generateInsights.ts` are
  upserted but never expired — a finding that stops being true (e.g. a
  bucket that's no longer projected to overspend) leaves a stale row. A
  future insight-lifecycle job should soft-delete/dismiss findings that no
  longer match on a fresh detector run.
- The worker's job scheduling is a plain `setInterval` loop, not a durable
  queue — correct for a single-instance household-scale deployment, not for
  multiple worker instances. Swap in pg-boss/BullMQ if that ever changes.
- Real provider integration (Basiq) is designed for but not implemented —
  see `docs/provider-integration.md` for exactly what's needed before
  connecting a real bank account.
