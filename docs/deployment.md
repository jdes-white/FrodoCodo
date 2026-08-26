# Deployment

## Current status: a private beta on Render, via Docker

`apps/web` runs as a conventional, long-lived Node/Next.js web service on
[Render](https://render.com), built from the repo's root `Dockerfile` and
backed by a Neon Postgres database (unchanged from before the Render
migration — see "Database (Neon)" below). This is a deliberate,
explicitly-confirmed scope decision (see `docs/product-decisions.md`): mock
financial provider, stubbed AI, no real household data, and the app's own
login screen still required — the deployment is reachable by URL over the
public internet but not listed, linked, or indexed anywhere, and no data is
visible without logging in.

`apps/worker` (the background sync/insight loop) is **not** deployed. It
isn't needed for the beta to function: the mock provider's dataset is
static, so there's nothing new for a background sync to pick up, and the
dashboard always reads directly from Postgres regardless of whether the
worker has ever run (§44). If a live-sync experience is ever wanted, the
simplest next step on Render is a **Background Worker** service (Render's
own service type for exactly this) running `apps/worker` from the same
image/repo — not a Vercel Cron Job, since Vercel is no longer the target
platform (see below).

## Vercel was tried and deliberately abandoned — do not reintroduce it

FrodoCodo ran on Vercel's serverless platform first. It was abandoned after
four separate, individually-verified attempts to get a Prisma-generated
runtime file (first a native query-engine binary, later a WASM query
compiler after switching Prisma to driver-adapter mode specifically to
avoid the native binary) reliably included in a deployed serverless
function. Every attempt looked correct against a local build's own file
trace and failed in production anyway — including one verified by copying
the exact traced file set into an isolated directory and running a real
query against it, and one verified by grepping the compiled output for the
literal bytes of the missing file. That pattern — passing every check
available locally, failing in Vercel's actual packaging — is what triggered
the move to Render: a normal Docker container has no serverless
function-packaging step for a file to go missing from, because nothing gets
selectively included by a tracer. We control the whole filesystem directly.

If you're a future Claude Code session (or a human) reading this because
FrodoCodo is having a deployment problem: **do not go back to Vercel, and
do not reintroduce Vercel-specific packaging workarounds** (output-file
tracing globs, WASM byte-embedding, driver-adapter Prisma modes chosen
*for packaging reasons* rather than reliability, `serverExternalPackages`
tuned around serverless bundling quirks, function `maxDuration` settings,
multi-candidate `DATABASE_URL` env-var-name guessing). None of that
architecture exists in this repo anymore, on purpose. If Render itself
ever needs to be replaced, evaluate it on its own merits — but the specific
failure mode that killed Vercel here (opaque platform-side packaging you
can't fully inspect or reproduce locally) is worth weighing heavily against
whatever replaces it.

The full turn-by-turn history of the Vercel attempts (and why each one
looked right and wasn't) lives in this repository's git history and
conversation log from that period, not duplicated here — this section is
the durable summary.

## Architecture

| Concern | Approach |
|---|---|
| Runtime | Long-lived Node process (`next start`) inside a Docker container, not a serverless function |
| Prisma | Standard Prisma Client with its native query-engine binary — see "Database runtime: Prisma" below |
| Database | Neon Postgres (unchanged), reached over a normal TCP connection |
| Migrations | `prisma migrate deploy`, run automatically as the first step of every container start — a failed migration blocks the release; see "Migrations" below |
| Hosting | Render Web Service, Docker runtime, Free plan |
| Background worker | Not deployed (see above) |

## Database (Neon)

The Neon Postgres database itself is unchanged by this migration — same
schema, same data, same project. What changed is how the connection
strings are supplied and used:

- `DATABASE_URL` — Neon's **pooled** (PgBouncer) connection string. The
  running app's queries use this (`packages/db/prisma/schema.prisma`'s
  `datasource db { url = env("DATABASE_URL") ... }`), which suits a
  long-lived service handling many requests against a small number of
  backend connections.
- `DIRECT_URL` — Neon's **direct** (non-pooled) connection string. Prisma's
  own `directUrl` datasource field (added alongside `url` in the same
  block) makes every `prisma migrate` command use this automatically
  instead — PgBouncer's transaction pooling mode doesn't support the
  advisory locks `migrate deploy` needs. This replaced a hand-rolled
  script that guessed which of several possible env-var names Vercel's
  Neon integration had used.

**Both `DATABASE_URL` and `DIRECT_URL` are required on Render** —
`render.yaml` declares both as `sync: false` secrets the owner must
supply. `PrismaClient` itself still instantiates and runs queries fine
with `DIRECT_URL` completely unset (verified empirically — it's read
only by `prisma migrate`/`introspect` CLI commands, never by the running
app's query path), but `apps/web/scripts/start.sh` now runs
`prisma migrate deploy` as part of every container start (see
"Migrations" below), and that command needs `DIRECT_URL` to actually do
anything. Without it, `migrate deploy` fails fast, the container never
starts Next.js, and Render keeps the previous release running — a
missing `DIRECT_URL` is a stalled deploy, not an outage, but it should
still be set before relying on this service to pick up new migrations.

Both connection strings come from Neon's dashboard (or `neon.tech`'s
connection-string picker, which offers pooled/direct variants directly).

## Database runtime: Prisma

Standard Prisma Client, native query-engine binary — deliberately the
"boring" option:

```prisma
generator client {
  provider      = "prisma-client-js"
  binaryTargets = ["native", "debian-openssl-3.0.x"]
}
```

`"native"` covers local development on whatever OS you're running;
`"debian-openssl-3.0.x"` covers the Dockerfile's `node:22-bookworm-slim`
base image. Both the build stage and the runtime stage of the Dockerfile
use the same Debian-based image specifically so the binary generated at
build time is guaranteed compatible with the OS it runs on at runtime.

This is a deliberate reversion from the driver-adapter architecture
(`@prisma/adapter-pg` + `pg`) used during the Vercel period, which existed
*only* to avoid shipping this native binary through Vercel's unreliable
function packaging. In a Docker container there's no packaging step to
distrust — we `COPY` the built application (including `node_modules` and
the generated Prisma client) into the final image ourselves, so the
question "did the deployment platform correctly include this file" simply
doesn't arise. `packages/db/src/index.ts` is back to a plain
`new PrismaClient()`, reading its connection string directly from
`env("DATABASE_URL")` in the schema.

`packages/db/package.json`'s `"postinstall": "prisma generate"` still
regenerates the client (and its binary) on every `pnpm install` — this
needs no database connection and succeeds even with no `.env` file
present, which is why the Docker build's `deps` stage can run it without
any secrets baked into the image.

## Containerization (Dockerfile)

Multi-stage build, root `Dockerfile`:

1. **`deps`** — copies every workspace package's `package.json` (plus the
   lockfile and the Prisma schema) and runs `pnpm install --frozen-lockfile`.
   This is its own stage so Docker's layer cache can skip reinstalling
   dependencies on every build when only application source changed.
2. **`builder`** — copies the rest of the source and runs
   `pnpm --filter @frodocodo/web build`.
3. **`runner`** — copies the *entire* `/app` directory tree (not just
   `node_modules`) from `builder`, runs as a non-root user, and starts the
   app via `apps/web/scripts/start.sh`.

**Why the whole tree, not a trimmed `node_modules`:** this is a pnpm
workspace. Workspace packages (`@frodocodo/db`, `@frodocodo/domain`, etc.)
are symlinked into `node_modules` rather than copied there, with each
symlink pointing at the real package directory under `packages/` or
`apps/`. Copying `node_modules` alone would leave those symlinks dangling.
Next.js's `output: "standalone"` mode (which traces and copies only the
files a build actually needs) was considered and deliberately not used —
after three rounds of a build-time file tracer being wrong about what a
deployment needed, a build known to be self-sufficient beats one more
tracer to trust blind. The image is larger as a result; for a two-user
beta, that tradeoff is fine (see "Free-tier constraints" below).

**Signal handling:** the final `CMD` runs `apps/web/scripts/start.sh`,
which `exec`s into the `next` binary directly as its last step (rather than
via `pnpm run`/`npm run`, which would leave an extra shell/process layer
around the actual server). That matters because Docker/Render send
`SIGTERM` to the container's PID 1 on every deploy or restart — a wrapper
process can absorb that signal instead of forwarding it, leaving Next.js
running until a hard `SIGKILL` after the full grace period instead of
shutting down promptly.

**Health check:** `HEALTHCHECK` in the Dockerfile hits `GET /api/health`
(the plain liveness route — see "Health checks" below) using Node's
built-in `fetch`, since the slim base image has no `curl`/`wget`.

## Migrations

**Migrations run automatically, as the first step of every container
start, and a failed migration blocks the release.** This replaced an
earlier "apply by hand against Neon" policy after that policy caused two
separate production outages (see "Incident precedent" below) — by-hand
migration is no longer this project's policy anywhere, and no path in
this repo should be reintroduced that relies on someone remembering to
run a command against Neon before or after a deploy.

`apps/web/scripts/start.sh` is the whole mechanism:

```sh
set -e
node_modules/.bin/prisma migrate deploy --schema=../../packages/db/prisma/schema.prisma
exec node_modules/.bin/next start
```

`set -e` means if `migrate deploy` exits non-zero for any reason — a
broken migration, a missing `DIRECT_URL`, a database that's briefly
unreachable — this script exits immediately too. `exec next start` never
runs, the container never opens its port, and Render's own health check
(`healthCheckPath: /api/health` in `render.yaml`, and the Dockerfile's
own `HEALTHCHECK`) never passes. Render's standard zero-downtime deploy
behavior then does the rest with no extra configuration: it cancels the
deploy after its health-check window elapses and keeps the previous,
still-working release serving traffic. This is Render's baseline
behavior for every service on every plan (including Free) — it doesn't
require Render's paid-plan-only `preDeployCommand` feature, which would
achieve the same guarantee more cleanly (the migration would run as its
own step rather than inside the app container) but isn't worth the
required plan upgrade for a two-user beta. Revisit `preDeployCommand` if
this service ever moves off the Free plan for other reasons (see "Future
architecture awareness").

**Invoke the `prisma` binary directly — never `pnpm run`/`pnpm --filter`
here.** The first version of this script ran
`pnpm --filter @frodocodo/db run migrate:deploy` and broke every
production deploy: the container's runtime user (Dockerfile's
`frodocodo`, a `useradd --system` account with no home directory, under
a non-writable `/home`) has nowhere for Corepack to create its
version-download cache, and invoking `pnpm` at all — even just to run a
package-local script — routes through Corepack's shim, which tries to
download/cache the exact `packageManager`-pinned pnpm version
(root `package.json`) before doing anything else. That failed with
`EACCES`/`mkdir` on `$HOME/.cache/node/corepack/v1` and took the whole
container down before Next.js ever started. `apps/web/package.json`
already lists `prisma` as a devDependency specifically so its own
`node_modules/.bin/prisma` exists in the built image — calling that
directly, with an explicit `--schema` path into `packages/db` (since the
script's cwd is `apps/web`, not `packages/db`), needs no package
manager, no Corepack, and no cache directory at all. This is the same
reasoning that already governs `next start` below — see the `exec`
comment.

Only ever `prisma migrate deploy` here — never `migrate dev` (development
-only, can prompt interactively and can be destructive), `db push`
(bypasses migration history entirely), or `migrate reset` (drops data).
`migrate deploy` only applies already-committed migration files, in
order, and is safe to run redundantly: it takes a Postgres advisory lock,
so if Render ever runs more than one instance through this script
concurrently, the second just waits and then finds nothing pending.

This is also why `render.yaml` now declares `DIRECT_URL` alongside
`DATABASE_URL` (see "Database (Neon)" below) — `migrate deploy` needs the
direct/non-pooled connection, since PgBouncer's transaction pooling mode
doesn't support the advisory locks it takes.

**Incident precedent** (why by-hand migration is no longer this
project's policy): two separate schema changes shipped application code
before their migration had been applied to the live Neon database, and
both crashed production:

1. The North Star migration (`20260822113229_add_north_star_assumptions`)
   crashed `/north-star` specifically with `PrismaClientKnownRequestError
   P2021` ("table does not exist") — every other page was unaffected
   since nothing else queried that table. This was patched with a
   targeted self-heal, `apps/web/lib/northStar.ts`'s
   `ensureNorthStarTable()`, which lazily creates that one
   table/index/constraint via idempotent raw SQL (`CREATE TABLE IF NOT
   EXISTS` etc.) over the ordinary pooled `DATABASE_URL` connection the
   app already has, the first time North Star is accessed. That self-heal
   is still in place (harmless now — it's a no-op once the table already
   exists from a real migration) but was never a general fix.
2. The Upcoming Commitments migration
   (`20260825111702_add_upcoming_commitments`) crashed the **entire app**
   the same way, because Home's dashboard queries the new
   `UpcomingCommitment` table on every single page load — this is what
   finally forced replacing the by-hand policy with the automatic one
   described above, rather than writing a third one-off self-heal.
   `apps/web/lib/commitments.ts`'s `listCommitments()` and every mutation
   in `apps/web/app/(app)/commitments/actions.ts` also catch that
   specific P2021 condition and degrade to "no commitments" rather than
   throwing — kept intentionally even with automatic migrations in place,
   as defense-in-depth: automatic migration should mean the table always
   exists by the time the app starts, but a missing additive table should
   still never take down the whole app if that assumption is ever wrong.

## Health checks

Two separate endpoints, deliberately:

- **`GET /api/health`** — plain liveness check, no database access. This
  is what `render.yaml`'s `healthCheckPath` points at, and what the
  Dockerfile's own `HEALTHCHECK` uses. Answers "is the Node process up,"
  which is the question a platform-level health check needs answered.
- **`GET /api/health/db`** — runs a real query (`SELECT 1`) through the
  exact same `prisma` singleton the rest of the app uses. Answers "can the
  app currently reach the database." Deliberately *not* what Render's
  platform health check uses: a transient Neon blip failing this
  temporarily shouldn't make Render decide the whole service is down and
  restart it — that doesn't fix a database-side problem and just adds a
  cold start on top of it. Use this one for manual/application-level
  verification (`curl https://<your-render-url>/api/health/db`, expect
  `{"ok":true}`).

`/api/health/db`'s failure response is sanitized (see
`packages/db/src/dbErrors.ts`): only an error class, a Prisma/Postgres
error code if present, and a redacted, length-capped message — never a
connection string, credential, or full stack trace.

## Demo login

```
admin@frodocodo.household
frodocodo-demo
```

Created by `seedDemoHousehold` (`packages/db/src/seedHousehold.ts`), which
wipes and repopulates a single synthetic household — see
`packages/db/prisma/seed.ts` for the local CLI entry point and
`apps/web/app/api/admin/seed/route.ts` for the production one.

**Do you need to seed again after the Render migration?** No, if the
existing Neon database already has the demo household — the database
itself didn't change, only the compute layer serving it. Check first with
`GET /api/health/db` (confirms connectivity) and then by attempting to log
in with the credentials above. Only call `POST /api/admin/seed` if login
fails because the household genuinely doesn't exist yet.

## Seed endpoint

`POST /api/admin/seed`, gated by the `SEED_TOKEN` env var
(`x-seed-token` header or `?token=` query param) — unchanged in behavior
from the Vercel period. It is:

- **Destructive**: wipes existing households before repopulating. Never
  call it against a database holding real household data.
- **Demo-only**: exists solely to populate/reset the synthetic beta
  household. Not wired into the build or startup path — it only runs when
  explicitly triggered.
- Planned to be **removed or disabled** before any real household
  financial data is introduced (see `docs/product-decisions.md`).

## Environment variables

| Variable | Required on Render | Notes |
|---|---|---|
| `DATABASE_URL` | **Yes (secret, owner-supplied)** | Neon's **pooled** connection string — the running app's own queries |
| `DIRECT_URL` | **Yes (secret, owner-supplied)** | Neon's **direct/non-pooled** connection string — required by `start.sh`'s automatic `prisma migrate deploy` step; never read by the running app itself — see "Migrations" above |
| `AUTH_SECRET` | Yes, but Render-generated | `render.yaml` uses `generateValue: true` — Render creates a fresh secure value at first deploy. Signs the session cookie (`apps/web/lib/session.ts`); a fresh value just means any pre-existing sessions need a fresh login, nothing else depends on it |
| `SEED_TOKEN` | Yes, but Render-generated | `render.yaml` uses `generateValue: true`. Gates `POST /api/admin/seed`; a fresh value is fine since this milestone doesn't call that endpoint against the Render deployment |
| `NODE_ENV` | No (default via Dockerfile: `production`) | |
| `FINANCIAL_PROVIDER` | No (default `mock`) | Left as `mock` for the beta |
| `AI_PROVIDER` | No (default `stub`) | Left as `stub` for the beta |
| `BASIQ_API_KEY` | Not currently required | Only if `FINANCIAL_PROVIDER=basiq` — see `docs/provider-integration.md` first |
| `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL` | Not currently required | Only if `AI_PROVIDER=anthropic` |
| `WORKER_SYNC_INTERVAL_MINUTES` | Not currently required | Only relevant if `apps/worker` is ever deployed as its own service |

`render.yaml` declares all of the Render-relevant rows above.
`DATABASE_URL` and `DIRECT_URL` are marked `sync: false` (Render prompts
for each in the dashboard; nothing is committed) — `AUTH_SECRET` and
`SEED_TOKEN` use `generateValue: true` instead, so the owner never has to
source or paste those two at all.

## Render deployment

`render.yaml` at the repo root is a Render Blueprint — importing this repo
on Render should configure the web service automatically (Docker runtime,
this `Dockerfile`, health check path, auto-deploy from
`claude/household-financial-os-90nezc`) with no manual build/start command
entry needed. See the root-level handoff notes for the exact remaining
manual steps (creating the Render account/service, pasting the secret
values — `DATABASE_URL` and `DIRECT_URL`, both from Neon; `AUTH_SECRET`
and `SEED_TOKEN` are generated by Render itself). `render.yaml`'s own
comments note that its field names
haven't been round-tripped through an actual Render import — verify them
against Render's current dashboard/Blueprint schema at import time.

## Free-tier constraints

This is a two-user household beta. The deployment is deliberately sized
for that:

- Render **Free** web service plan — sleeps when unused, cold-starts on
  the next request. Acceptable for this stage.
- No Redis, queues, additional databases, or paid observability —
  nothing the web app doesn't genuinely need to operate is deployed.
- `apps/worker` stays undeployed (see above).

## Future architecture awareness

None of the above tightly couples FrodoCodo's product logic to Render.
When any of these become real requirements, they're independent decisions,
not a reason to revisit the deployment architecture:

- Real Basiq/Open Banking integration — see `docs/provider-integration.md`.
- Real household financial data — reconsider Neon's free-tier
  encryption-at-rest/backup posture first, see `docs/security-privacy.md`.
- A second household user, and later additional households.
- Runtime LLM integration (`AI_PROVIDER=anthropic`).
- A native React Native/Expo mobile client — talks to the same API routes.
- A custom domain, and a paid/always-on Render plan once cold starts
  matter — if/when this service moves off the Free plan for that reason,
  also revisit whether to move the migration step from `start.sh` (see
  "Migrations" above) to Render's `preDeployCommand`, which is
  functionally equivalent but only available on paid plans and runs the
  migration as its own step rather than inside the app container.

## Local development

```bash
docker compose up -d postgres     # or use a local Postgres install
pnpm install
pnpm --filter @frodocodo/db exec prisma migrate dev --name init
pnpm db:seed
pnpm dev            # apps/web
pnpm dev:worker      # apps/worker, separate terminal
```

## Local production validation (Docker)

Build and run the actual production image locally before trusting a
deploy:

```bash
docker build -t frodocodo .
docker run --rm -p 3000:3000 \
  -e DATABASE_URL="postgresql://frodocodo:frodocodo@host.docker.internal:5432/frodocodo?schema=public" \
  -e DIRECT_URL="postgresql://frodocodo:frodocodo@host.docker.internal:5432/frodocodo?schema=public" \
  -e AUTH_SECRET="$(openssl rand -base64 32)" \
  -e SEED_TOKEN="local-test-token" \
  frodocodo
```

(`DIRECT_URL` is now required here too, matching what Render requires —
`start.sh` runs `prisma migrate deploy` as its first step, and that
command needs it. Local Postgres has no pooled/direct distinction, so
both env vars point at the same connection string; that's specific to
this docker-run smoke test, not a hint that Neon's two strings are
interchangeable in any deployed environment.)

Then, against `http://localhost:3000`: `GET /api/health` and
`GET /api/health/db` both return `{"ok":true}`; `POST /api/admin/seed`
(with the `x-seed-token` header) succeeds; and logging in as
`admin@frodocodo.household` / `frodocodo-demo` reaches the authenticated
dashboard, with `/transactions`, `/plan`, `/insights`, and `/settings` all
loading.
