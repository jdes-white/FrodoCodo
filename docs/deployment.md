# Deployment

## Current status: a private beta on Vercel

`apps/web` is deployed to Vercel (Hobby/free plan), backed by a Neon
Postgres database provisioned through Vercel's own Storage integration —
both on free tiers, $0 cost at this app's scale. This was a deliberate,
explicitly-confirmed scope decision (see `docs/product-decisions.md`):
mock financial provider, stubbed AI, no real household data, and the app's
own login screen still required — the deployment is reachable by URL over
the public internet but not listed, linked, or indexed anywhere, and no
data is visible without logging in.

`apps/worker` (the background sync/insight loop) is **not** deployed. It
isn't needed for the beta to function: the mock provider's dataset is
static, so there's nothing new for a background sync to pick up, and the
dashboard always reads directly from Postgres regardless of whether the
worker has ever run (§44). If a live-sync experience is ever wanted, the
next step is a Vercel Cron Job hitting a route handler that runs the same
`packages/worker` logic, not a separate always-on process — see the
"Worker" section below.

## Why Vercel (+ its Neon integration) specifically

Vercel is built by the Next.js team, so deploying this app is close to
zero-configuration, and its Storage tab provisions a free-tier Postgres
database (Neon under the hood) inside the *same* account/dashboard — one
account covers hosting and the database, which is simpler than any
alternative for this app. See the chat history / `docs/product-decisions.md`
for the account-creation and public-accessibility tradeoffs that were
explicitly confirmed before deploying.

## Why deploys weren't happening (diagnosed, not guessed)

Vercel kept serving the very first commit (`2889a60`, pre-dating this whole
app) no matter what got pushed. The repo-side diagnosis: `main` has **zero**
commits since that initial import — all real work lives on
`claude/household-financial-os-90nezc`, currently 7+ commits ahead. Vercel
only auto-builds on pushes to its configured **Production Branch**. If that
setting is still `main` (its default when a project is first imported), it
is *correctly* doing nothing — there's nothing new on `main` to build. This
setting lives only in Vercel's project database, not in this repo, so it
cannot be fixed by a commit — see the "One thing that can't be fixed from
the repo" note at the end of this section.

Everything else — Root Directory ambiguity, framework detection, build
commands — has been made robust to the point of not mattering, per point 5
below.

## What makes this monorepo deployable on Vercel

A plain `next build` isn't enough for this repo — these things had to be
in place, and stay in place if you touch these files:

1. **Prisma Client must be (re)generated on every install.**
   `packages/db/package.json` has `"postinstall": "prisma generate"` — pnpm
   runs this automatically for every workspace package during `pnpm
   install`, which is what Vercel's build runs first. Without it, the build
   fails looking for a Prisma Client that was never generated (it's
   git-ignored, not committed). The Prisma Client is generated to its
   **default** location (`node_modules/@prisma/client`, imported as
   `from "@prisma/client"` in `packages/db/src/index.ts`) rather than a
   custom `output` path — a custom path outside `node_modules` is a known
   source of Next.js build-tracing failures in serverless deployments
   (the query-engine binary silently not getting included in the deployed
   function), so this repo deliberately uses the well-trodden default.
2. **The Prisma schema declares a serverless-compatible binary target.**
   `generator client { binaryTargets = ["native", "rhel-openssl-3.0.x"] }`
   in `packages/db/prisma/schema.prisma` — `native` covers local dev,
   `rhel-openssl-3.0.x` covers Vercel's serverless runtime. Without this,
   the build succeeds but the deployed app crashes at runtime on the first
   database query.
3. **Migrations run automatically on every deploy, seeding does not.**
   `apps/web/package.json`'s `vercel-build` script (Vercel uses this
   instead of `build` automatically, if present) runs
   `apps/web/scripts/vercel-build.mjs`, which does `prisma migrate deploy`
   then `next build`. `migrate deploy` only applies pending migrations —
   safe and idempotent on every push. Seeding is deliberately **not** part
   of this: it wipes existing households first (see
   `packages/db/src/seedHousehold.ts`), so running it on every deploy would
   erase real usage data. Seeding instead runs on demand via
   `POST /api/admin/seed` (`apps/web/app/api/admin/seed/route.ts`),
   protected by a `SEED_TOKEN` env var — this also means the database
   connection string never has to leave Vercel's own environment variable
   store to populate demo data.
4. **The database connection string's env var name isn't assumed.**
   Depending on how a Postgres integration provisions the database, the
   connection string can land under different names — `DATABASE_URL`,
   `POSTGRES_PRISMA_URL`/`POSTGRES_URL` (pooled), or
   `DATABASE_URL_UNPOOLED`/`POSTGRES_URL_NON_POOLING` (direct). Guessing
   wrong means a silent "environment variable not found" failure.
   `packages/db/scripts/resolveDatabaseUrl.mjs` checks all of them; the
   build wrapper (`apps/web/scripts/vercel-build.mjs`) and the `postinstall`
   wrapper (`packages/db/scripts/generate.mjs`) both use it for build-time
   Prisma CLI calls, preferring a **direct/unpooled** connection for
   `migrate deploy` specifically (Prisma's migration engine needs one —
   advisory locks don't work reliably through pgbouncer's transaction
   pooling mode). The running app (`packages/db/src/index.ts`) does the
   same resolution at runtime via `new PrismaClient({ datasourceUrl })`,
   preferring the **pooled** connection there (better suited to
   serverless's many short-lived connections).
5. **Deployment no longer depends on Vercel's Root Directory setting being
   correct.** A root-level `vercel.json` explicitly sets `framework`,
   `installCommand`, `buildCommand` (`pnpm --filter @frodocodo/web run
   vercel-build`), and `outputDirectory` (`apps/web/.next`) — this works
   correctly with Vercel's Root Directory left at the repo root (the
   default/blank state). `apps/web/package.json` still has its own
   `vercel-build` script too, so if Root Directory is instead set to
   `apps/web`, Vercel's zero-config Next.js detection finds and uses that
   directly and the root `vercel.json` is simply not read (Vercel only
   looks for `vercel.json` at the configured Root Directory). Both paths
   produce the same result — this was made redundant on purpose so a
   half-completed dashboard change can't break the build either way.
   **Root Directory is the one setting from earlier troubleshooting that
   this change makes irrelevant — leave it as whatever it currently is.**

### One thing that can't be fixed from the repo

**Production Branch** (Vercel → Project → Settings → Git) must be
`claude/household-financial-os-90nezc` for pushes to that branch to
auto-deploy to the production URL. This is stored in Vercel's own project
configuration, not in this repository, so no commit can change it — it must
be set once in the dashboard (or via the Vercel API/CLI with a token, which
this repo does not have and should not be given for this).

## Environment variables

See `.env.example` for the full list with inline explanations. On Vercel,
`DATABASE_URL` (plus a few Postgres-adjacent variables) is set automatically
by the Storage → Postgres integration — nothing to paste in manually.
Everything else is set once under Project Settings → Environment Variables:

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | Yes | Set automatically by Vercel's Postgres (Neon) integration |
| `AUTH_SECRET` | Yes | Random 32-byte secret for session signing (`openssl rand -base64 32`) |
| `SEED_TOKEN` | Yes, to (re)seed demo data | Random secret (`openssl rand -base64 24`) — gates `POST /api/admin/seed` |
| `FINANCIAL_PROVIDER` | No (default `mock`) | Left as `mock` for the beta — see `docs/provider-integration.md` before ever setting `basiq` |
| `BASIQ_API_KEY` | Only if `FINANCIAL_PROVIDER=basiq` | Not set for the beta |
| `AI_PROVIDER` | No (default `stub`) | Left as `stub` for the beta |
| `ANTHROPIC_API_KEY` | Only if `AI_PROVIDER=anthropic` | Not set for the beta |
| `WORKER_SYNC_INTERVAL_MINUTES` | No (default 60) | Only relevant if `apps/worker` is ever deployed |

## Ongoing iteration

The Vercel project is connected directly to the
`claude/household-financial-os-90nezc` GitHub branch as its Production
Branch — every push to that branch triggers an automatic redeploy (typically
live within 1-2 minutes), running the migration step above automatically.
No manual redeploy step, no re-entering credentials.

## If real accounts are ever connected

1. Complete the integration in `docs/provider-integration.md`, then set
   `FINANCIAL_PROVIDER=basiq` and `BASIQ_API_KEY` on Vercel.
2. Set `AI_PROVIDER=anthropic` and `ANTHROPIC_API_KEY` if real AI narratives
   are wanted (optional — the stub is fully functional).
3. Reconsider the free-tier hosting choice at that point: real financial
   data raises the bar on encryption-at-rest, backups, and access controls
   beyond what a free-tier database offers by default — see
   `docs/security-privacy.md`.
4. Do **not** call `POST /api/admin/seed` again once real data exists — it
   wipes households first.

## Worker (not currently deployed)

If/when a live-sync experience is wanted: the simplest option is a Vercel
Cron Job (Hobby plan supports a limited number of daily cron triggers)
hitting a new route handler that calls the same `syncConnection` /
`generateInsightsForHousehold` functions apps/worker uses today
(`apps/worker/src/syncConnection.ts`, `generateInsights.ts`) — not a
separate always-on process, which Vercel's serverless model doesn't
support anyway. `apps/worker` as it exists today remains the right choice
for a self-hosted/VM deployment (Fly.io, Railway, etc.), documented for
that path below.

### Self-hosted alternative (worker, or the whole app)

| Component | Recommendation | Why |
|---|---|---|
| `apps/web` | Vercel | See above |
| `apps/worker` | Fly.io or Railway | Needs to be a long-running process — serverless functions have execution-time limits unsuitable for sync jobs |
| Database | Neon (serverless Postgres) | Works standalone too, not just via Vercel's integration |

```bash
# Provisioning a long-running worker anywhere Node runs:
pnpm --filter @frodocodo/db exec prisma migrate deploy   # once, or on every deploy — idempotent
pnpm --filter @frodocodo/worker start
```

## Local development

```bash
docker compose up -d postgres     # or use a local Postgres install
pnpm install
pnpm --filter @frodocodo/db exec prisma migrate dev --name init
pnpm db:seed
pnpm dev            # apps/web
pnpm dev:worker      # apps/worker, separate terminal
```
