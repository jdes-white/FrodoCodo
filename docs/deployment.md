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

The **Vercel project-root convention is: Root Directory = `apps/web`.**
That's where `package.json` (with `next` as a real dependency) lives, so
Vercel's zero-config Next.js detection and its automatic pnpm-workspace
monorepo install (installing from the true repo root so sibling packages
like `@frodocodo/domain` resolve, even though the build itself runs scoped
to `apps/web`) both work with no extra configuration — this was confirmed
empirically: a deploy with Root Directory=`apps/web` completed the entire
`next build` successfully, including resolving every workspace package.

A root-level `vercel.json` was tried at one point to make deployment work
regardless of Root Directory, and made things *worse*: Vercel still reads
a repo-root `vercel.json` even when Root Directory is set to a subfolder,
and resolves its path fields (like `outputDirectory`) **relative to Root
Directory** — so `outputDirectory: "apps/web/.next"` resolved to
`apps/web/apps/web/.next`, which doesn't exist. **There is no root-level
`vercel.json` in this repo** — don't reintroduce one for this app; see
point 5 below for what actually goes in `apps/web/package.json` instead.

## What makes this monorepo deployable on Vercel

A plain `next build` isn't enough for this repo — these things had to be
in place, and stay in place if you touch these files:

1. **Prisma Client must be (re)generated on every install.**
   `packages/db/package.json` has `"postinstall": "node scripts/generate.mjs"`
   — pnpm runs this automatically for every workspace package during `pnpm
   install`, which is what Vercel's build runs first. Without it, the build
   fails looking for a Prisma Client that was never generated (it's
   git-ignored, not committed).
2. **Prisma runs in driver-adapter mode: no native query-engine binary
   exists anywhere in this deployment, by design — this replaced three
   failed attempts at packaging one.** The history, in order:

   - **Attempt 1**: `generator client { binaryTargets = ["native", "rhel-openssl-3.0.x"] }`
     plus the plain client (`new PrismaClient({ datasourceUrl })`). Builds
     succeeded; the deployed function crashed on its first query with
     "Prisma Client could not locate the Query Engine" — the binary wasn't
     making it into the Lambda.
   - **Attempt 2**: `outputFileTracingIncludes` force-including the engine
     binary's path inside pnpm's nested `.pnpm` virtual store
     (`node_modules/.pnpm/@prisma+client@<hash>/node_modules/.prisma/client/`).
     This looked correct by every local check available —
     `.next/server/app/**/*.nft.json` listed the binary after the build —
     and **production failed the same way anyway**, proving a local
     `.nft.json` grep is not sufficient proof of what Vercel actually
     deploys.
   - **Attempt 3**: root-level `.npmrc` with `node-linker=hoisted`, flattening
     `node_modules` so the binary sat at a plain, well-supported path
     instead of nested inside `.pnpm`. This one was verified rigorously —
     the exact file set an `.nft.json` listed was copied into an isolated
     directory reproducing a real Vercel Lambda's `/var/task/...` layout,
     and a real Prisma query succeeded from inside it with zero access to
     the project's actual `node_modules` — and it worked. `/login` came
     back up.
   - Then a **new** failure surfaced on `/login` a build later:
     `FUNCTION_INVOCATION_TIMEOUT` from the seed endpoint (unrelated —
     fixed by batching `seedDemoHousehold`'s ~450 sequential DB round-trips
     into a handful of bulk statements, see the git history), and after
     that, the query-engine-not-found error itself came back on `/login`
     specifically even though the isolated-directory test had proven the
     flat-layout fix worked. At that point continuing to chase the native
     binary's packaging stopped being the right call — three attempts,
     each individually well-verified, each still capable of breaking again
     — and the architecture changed instead.

   **The actual fix: stop shipping a native query engine at all.**
   `packages/db/prisma/schema.prisma`'s generator sets `engineType = "client"`
   (Prisma's driver-adapter mode), and `packages/db/src/index.ts` constructs
   `PrismaClient` with `adapter: new PrismaPg(pool)` — a real `pg.Pool`
   (`@prisma/adapter-pg` + the `pg` package) — instead of a bare
   `datasourceUrl`. Prisma Client no longer owns a database connection or a
   compiled Rust engine for query execution at all; it generates SQL and
   hands every query to `pg`, which is a battle-tested, pure-JS-resolvable
   driver with no platform-specific binary of its own. `binaryTargets` is
   gone from the schema entirely — there's no per-platform variant to get
   wrong, because there's no native binary to select one for.

   This is not a workaround layered on top of the native-engine
   architecture; it removes the entire class of problem that produced three
   separate production failures.

   **One binary asset remains**, and it's a materially different animal:
   `node_modules/.prisma/client/query_compiler_bg.wasm`, a small (~2MB),
   platform-agnostic WebAssembly query *compiler* (SQL generation only — no
   connection, no execution, and the *same file* regardless of OS/libc, so
   there's no `binaryTargets`-style "wrong platform" failure mode possible).
   It's loaded via `fs.readFileSync` at runtime by the plain `@prisma/client`
   import.

   A cleaner-sounding alternative was tried and rejected: importing
   `@prisma/client/wasm` instead, which loads the same file via a real
   `import()` rather than a runtime file read — in principle lets webpack
   bundle it as a normal asset instead of needing any tracing help at all.
   It built successfully and traced automatically with zero custom config,
   but **every query failed at runtime** with "the loaded wasm module was
   unexpectedly undefined or null": that entry point is built for
   edge/worker runtimes with native ESM-WebAssembly import support, and the
   module shape it expects doesn't match what webpack's `asyncWebAssembly`
   experiment produces when bundling a Node.js server route. Diagnosed by
   reading the generated loader code directly
   (`node_modules/.prisma/client/wasm.js` and its
   `wasm-worker-loader.mjs`/`wasm-edge-light-loader.mjs` siblings), not by
   guessing. Reverted to the plain `@prisma/client` import, which is what
   Prisma actually tests against Node.js server runtimes.

   Given that, `apps/web/next.config.ts` keeps `serverExternalPackages:
   ["@prisma/client"]` (so webpack leaves that runtime file read alone
   rather than mangling it while bundling) and a narrow
   `outputFileTracingIncludes` pointing at just
   `query_compiler_bg.*` (keyed on both `"/**/*"` and `"/"` — the wildcard
   alone doesn't match the bare root route under minimatch) — one ~2MB file,
   not the ~35MB of dual-platform native binaries the old `binaryTargets`
   setup shipped. Root `.npmrc` (`node-linker=hoisted`) still keeps
   `node_modules` flat, which remains good practice independent of Prisma.

   **How this was verified**: after building, `.next/server/app/**/*.nft.json`
   was confirmed to list `query_compiler_bg.wasm` for every route that
   touches Prisma (all 9 of them) and zero `.so.node` files anywhere in
   `node_modules`. `@prisma/adapter-pg`'s actual implementation (verified by
   grepping for its distinctive method names — `startTransaction`,
   `executeScript`, `underlyingDriver`) is bundled directly into the
   `transpilePackages`-compiled chunks, not left as a separate traced
   dependency at all. Then the full pipeline was run for real: `prisma
   migrate deploy` against a live Postgres, `next build`, `next start`, a
   real `POST /api/admin/seed` (the same 157-transaction seed that
   previously timed out), and a real headless-browser login as
   `admin@frodocodo.household` — landing on the authenticated dashboard
   with zero non-2xx/3xx HTTP responses anywhere in the flow.

   If a Prisma runtime error ever surfaces again: don't trust a local
   `.nft.json` grep as sufficient proof by itself. Copy the exact file set
   an `.nft.json` lists into an isolated directory (nothing else on the
   path) and run a real Prisma query against only those files — the way
   every one of these was actually diagnosed, not guessed at.
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
   same resolution at runtime and passes it to the `pg.Pool` that backs
   Prisma's driver adapter (`new Pool({ connectionString })`), preferring
   the **pooled** connection there (better suited to serverless's many
   short-lived connections; node-postgres's unnamed prepared statements are
   safe through pgbouncer's transaction pooling mode).
5. **No root-level `vercel.json` — `apps/web/package.json`'s own
   `vercel-build` script is the single build entry point.** With Root
   Directory=`apps/web`, Vercel's zero-config Next.js detection finds
   `package.json` there (real `next` dependency → Framework Preset =
   Next.js) and automatically runs the `vercel-build` script instead of
   `build` when one is present — no Build/Install/Output Directory
   overrides needed in the Vercel dashboard, and none should be set. That
   script (`apps/web/scripts/vercel-build.mjs`) runs with its working
   directory already at `apps/web` (Root Directory), so its relative paths
   into `packages/db` climb up through the repo root as normal
   (`../../packages/db/...`).

### Two things that can't be fixed from the repo

- **Root Directory** (Vercel → Project → Settings → General) must be
  `apps/web`. Framework Preset should read/auto-detect as Next.js once
  that's correct; Build Command, Install Command, and Output Directory
  should all be left **unset/blank** (no overrides) — the defaults driven
  by Root Directory + `apps/web/package.json`'s `vercel-build` script are
  exactly what's needed.
- **Production Branch** (Vercel → Project → Settings → Git) must be
  `claude/household-financial-os-90nezc` for pushes to that branch to
  auto-deploy to the production URL.

Both are stored in Vercel's own project configuration, not in this
repository, so no commit can change either — they're set once in the
dashboard (or via the Vercel API/CLI with a token, which this repo does not
have and should not be given for this).

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
