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

## What makes this monorepo deployable on Vercel

A plain `next build` isn't enough for this repo — three things had to be
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
   `apps/web/package.json` has a `vercel-build` script (Vercel uses this
   instead of `build` automatically, if present):
   `prisma migrate deploy --schema=../../packages/db/prisma/schema.prisma
   && next build`. `migrate deploy` only applies pending migrations — safe
   and idempotent on every push. Seeding is deliberately **not** part of
   this: it wipes existing households first (see
   `packages/db/src/seedHousehold.ts`), so running it on every deploy would
   erase real usage data. Seeding instead runs on demand via
   `POST /api/admin/seed` (`apps/web/app/api/admin/seed/route.ts`),
   protected by a `SEED_TOKEN` env var — this also means the database
   connection string never has to leave Vercel's own environment variable
   store to populate demo data.

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
