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

- **Vercel was tried and deliberately abandoned. Do not reintroduce it, or
  any packaging workaround that exists to route around its serverless
  function packaging.** Four separate, individually-verified attempts to
  get a Prisma-generated runtime file reliably into a deployed Vercel
  function all failed in production despite passing every local check —
  see `docs/deployment.md`'s "Vercel was tried and deliberately abandoned"
  section for the summary and why that specific failure mode (opaque
  platform-side packaging you can't fully inspect locally) is what killed
  it. FrodoCodo now runs as a conventional Docker container on Render — a
  long-lived process, not a serverless function, built from the root
  `Dockerfile`. There is no `vercel.json`, no `outputFileTracingIncludes`,
  no WASM byte-embedding, no driver-adapter Prisma mode chosen for
  packaging reasons, no function `maxDuration`, no multi-candidate
  `DATABASE_URL` env-var-name guessing — none of that Vercel-era
  architecture should come back without a concrete, Render-specific reason.
- **Prisma runs with its standard native query-engine binary — this is
  deliberate, not an oversight.** `packages/db/prisma/schema.prisma`'s
  generator declares `binaryTargets = ["native", "debian-openssl-3.0.x"]`
  ("native" for local dev, "debian-openssl-3.0.x" matching the
  Dockerfile's `node:22-bookworm-slim` base image used for both the build
  and runtime stages), and `packages/db/src/index.ts` is a plain
  `new PrismaClient()` reading `env("DATABASE_URL")` from the schema — no
  driver adapter, no manual connection-string plumbing. This native-engine
  setup is exactly what the Vercel period moved *away* from (toward
  `@prisma/adapter-pg` + `pg`, specifically to avoid shipping this binary
  through Vercel's unreliable packaging) and has now moved back *to*,
  because in a Docker container the whole filesystem is something we
  control and `COPY` ourselves — there's no packaging step for the binary
  to go missing from. See `docs/deployment.md` for the full reasoning.
- **The Dockerfile copies the entire built `/app` tree into the runtime
  image, not just a trimmed `node_modules`.** This is a pnpm workspace —
  workspace packages are symlinked into `node_modules`, with symlink
  targets pointing at the real package directories under `packages/`/
  `apps/`. Copying `node_modules` alone would leave those symlinks
  dangling. `output: "standalone"` (Next.js's own file-tracing-based
  trimming) was considered and deliberately not used, for the same reason
  Vercel's tracer isn't trusted anymore. See `docs/deployment.md`.
- **`apps/web/scripts/start.sh` does not run migrations.** It `exec`s
  straight into `next start` — the final `exec` (rather than running it
  via `pnpm run`/`npm run`) is what lets `SIGTERM` reach the actual Node
  process directly for a clean shutdown. Migrations are applied by hand
  (`prisma migrate deploy`, run manually against the target database) —
  the current beta's Neon database is already migrated, so nothing runs
  this automatically on deploy. If that ever changes, `migrate deploy` is
  safe to wire into container start even under concurrent multi-instance
  startup — it takes a Postgres advisory lock, so a second instance just
  waits and then sees nothing pending — but that's a deliberate future
  decision to make explicitly, not the current default. See
  `docs/deployment.md`'s "Migrations" section.
- `packages/db/package.json`'s `"postinstall": "prisma generate"` is what
  makes the Prisma Client exist after `pnpm install` on a machine that's
  never run `prisma generate` manually (every CI/deploy environment,
  including the Docker build's `deps` stage). Don't remove it. It needs no
  database connection to succeed — only the schema, which is why the
  Docker build stage can run it with no secrets present.
- **The database connection string env vars are `DATABASE_URL` (pooled)
  and `DIRECT_URL` (direct/non-pooled)** — Prisma's own first-class
  `directUrl` datasource field (`packages/db/prisma/schema.prisma`) makes
  every `prisma migrate` command use `DIRECT_URL` automatically instead of
  `DATABASE_URL`, since PgBouncer's transaction pooling mode doesn't
  support the advisory locks migrations need. `DATABASE_URL` is required
  in every environment (the running app reads only this one). `DIRECT_URL`
  is only read by `prisma migrate`/`introspect` CLI commands — verified
  empirically that `PrismaClient` instantiates and queries fine with it
  completely unset — so Render's Blueprint (`render.yaml`) doesn't declare
  it; set it by hand only when actually running a migration against a
  Render-hosted database.
- **Seeding and migrations never run automatically on deploy or on
  container start.** `apps/web/scripts/start.sh` only starts Next.js.
  `seedDemoHousehold` (`packages/db/src/seedHousehold.ts`) wipes existing
  households first, so it only runs on demand via `POST /api/admin/seed`
  (token-gated by `SEED_TOKEN`). Migrations are applied by hand
  (`prisma migrate deploy`) against whichever database needs them. Never
  wire either into the build or startup path without a deliberate reason
  — see `docs/deployment.md`'s "Migrations" section for the current
  reasoning.
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
