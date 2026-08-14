# Deployment

Nothing is deployed by this repo — see `docs/product-decisions.md` for why
(the owner chose "codebase only" for this build; provisioning live hosting
accounts on someone's behalf isn't something to do without them present).
This documents the recommended path when that changes.

## Recommended targets

| Component | Recommendation | Why |
|---|---|---|
| `apps/web` | Vercel | First-class Next.js support, fast edge delivery for the dashboard's first paint |
| `apps/worker` | Fly.io or Railway | Needs to be a long-running process — serverless functions have execution-time limits unsuitable for sync jobs |
| Database | Neon (serverless Postgres) | Branch-per-PR previews, generous free tier for household scale |

These are recommendations, not requirements — any Postgres-compatible host
and any Node-capable process host work, since nothing in the codebase is
platform-specific beyond standard environment variables.

## Environment variables

See `.env.example` for the full list with inline explanations. Summary:

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | Yes | Postgres connection string |
| `AUTH_SECRET` | Yes | Random 32-byte secret for session signing (`openssl rand -base64 32`) |
| `FINANCIAL_PROVIDER` | No (default `mock`) | `mock` or `basiq` — see `docs/provider-integration.md` |
| `BASIQ_API_KEY` | Only if `FINANCIAL_PROVIDER=basiq` | Server-side only |
| `AI_PROVIDER` | No (default `stub`) | `stub` or `anthropic` |
| `ANTHROPIC_API_KEY` | Only if `AI_PROVIDER=anthropic` | Server-side only |
| `ANTHROPIC_MODEL` | No | Defaults to `claude-sonnet-5` in `AnthropicGateway` |
| `WORKER_SYNC_INTERVAL_MINUTES` | No (default 60) | How often `apps/worker` runs a sync + insight-generation cycle |

## Steps (once you have real hosting accounts)

1. Provision Postgres, run `pnpm --filter @frodocodo/db exec prisma migrate deploy` against it.
2. Set the environment variables above on both the web and worker hosts.
3. Deploy `apps/web` (standard Next.js build: `pnpm --filter @frodocodo/web build`).
4. Deploy `apps/worker` as a long-running process (`pnpm --filter @frodocodo/worker start`).
5. Do **not** run `pnpm db:seed` against a database holding real household
   data — it wipes existing households first (see the warning at the top of
   `packages/db/prisma/seed.ts`). Seeding is for demo/dev databases only.
6. Set `FINANCIAL_PROVIDER=basiq` and connect real institutions only after
   completing the integration in `docs/provider-integration.md`.

## Local development

```bash
docker compose up -d postgres     # or use a local Postgres install
pnpm install
pnpm --filter @frodocodo/db exec prisma migrate dev --name init
pnpm db:seed
pnpm dev            # apps/web
pnpm dev:worker      # apps/worker, separate terminal
```
