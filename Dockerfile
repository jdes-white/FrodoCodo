# syntax=docker/dockerfile:1
#
# Production image for FrodoCodo's Next.js app (apps/web). Multi-stage so
# the dependency-install layer (usually unchanged between deploys) caches
# separately from the application-source layer. The background worker
# (apps/worker) is intentionally not built or run here — the web app
# doesn't depend on it (see docs/deployment.md).
#
# All three stages use the same Debian-based Node image deliberately: this
# repo's Prisma schema declares binaryTargets = ["native",
# "debian-openssl-3.0.x"] (see packages/db/prisma/schema.prisma), and the
# generated native query-engine binary must match the OS/libc it actually
# runs on. Using one base image throughout removes any ambiguity about
# whether the binary generated at build time will work at run time.
#
# This is a pnpm workspace: workspace packages (@frodocodo/db,
# @frodocodo/domain, etc.) are symlinked into node_modules by pnpm rather
# than copied there, with each symlink pointing at the real package
# directory under packages/ or apps/ — so the final stage copies the whole
# /app directory tree (node_modules *and* packages/ *and* apps/) rather
# than trying to cherry-pick node_modules alone, which would leave those
# symlinks dangling.

FROM node:22-bookworm-slim AS base
RUN corepack enable
WORKDIR /app

# ---------- deps: install once, cache until package.json/lockfile change ----------
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/db/prisma packages/db/prisma
COPY packages/domain/package.json packages/domain/package.json
COPY packages/ledger/package.json packages/ledger/package.json
COPY packages/providers/package.json packages/providers/package.json
COPY packages/ai/package.json packages/ai/package.json
COPY packages/shared/package.json packages/shared/package.json
# `pnpm install`'s postinstall runs `prisma generate` (packages/db/package.json).
# That only needs the schema (already copied above) to produce a client —
# no database connection is required or attempted at build time.
RUN pnpm install --frozen-lockfile

# ---------- builder: bring in the rest of the source and build the app ----------
FROM base AS builder
COPY --from=deps /app /app
COPY . .
RUN pnpm --filter @frodocodo/web build

# ---------- runner: the actual production image ----------
FROM node:22-bookworm-slim AS runner
RUN corepack enable
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

# Runs as a non-root user — standard container hardening, not
# platform-specific.
RUN groupadd --system --gid 1001 frodocodo \
  && useradd --system --uid 1001 --gid frodocodo frodocodo

COPY --from=builder --chown=frodocodo:frodocodo /app /app
# Belt-and-braces: git tracks the executable bit and COPY preserves it, but
# make it explicit rather than relying on that chain holding every time.
RUN chmod +x /app/apps/web/scripts/start.sh

USER frodocodo
WORKDIR /app/apps/web
EXPOSE 3000

# Dependency-free (no curl/wget in the slim base image): Node 18+ ships a
# global fetch. Checks the plain liveness route, not /api/health/db — a
# transient database hiccup shouldn't make Docker/Render think the process
# itself is unhealthy and restart it.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# apps/web/scripts/start.sh applies pending migrations (prisma migrate
# deploy — safe to run redundantly / from concurrent instances, see the
# script's own comments) and then `exec`s into the `next` binary directly,
# not through `pnpm run`/`npm run` — those wrap the actual server in an
# extra shell/process layer that can swallow SIGTERM before it reaches
# Next.js, leaving Render (or any orchestrator) waiting out the full grace
# period for a hard SIGKILL on every deploy or restart instead of shutting
# down promptly. next start reads the PORT env var itself; Render sets
# PORT and this image's own ENV PORT=3000 above is the default for any
# other Docker host.
CMD ["./scripts/start.sh"]
