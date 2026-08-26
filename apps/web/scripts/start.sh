#!/bin/sh
# Container entrypoint (invoked by the Dockerfile's CMD, from WORKDIR
# /app/apps/web): apply any pending database migrations, then hand off to
# Next.js — but only if the migration step actually succeeded.
#
# `set -e` is the whole safety mechanism here: `pnpm --filter @frodocodo/db
# run migrate:deploy` (packages/db/package.json's own script, `prisma
# migrate deploy`) runs first; if it exits non-zero for any reason — a
# broken migration, a missing DIRECT_URL, a database that's briefly
# unreachable — this script exits immediately too, `exec next start` never
# runs, the container never opens its port, and Render's own health check
# (Dockerfile's HEALTHCHECK / render.yaml) never passes. Render's standard
# zero-downtime deploy behaviour then keeps the previous, still-working
# release serving traffic and marks this deploy as failed — see
# docs/deployment.md's "Migrations" section for the full reasoning and why
# this replaced the previous by-hand migration policy.
#
# `prisma migrate deploy` only ever applies already-committed migrations
# in order — never `migrate dev`, `db push`, or `migrate reset` (all of
# which can drop/rewrite data or prompt interactively, neither of which
# belongs in a container entrypoint). It's also safe to run redundantly:
# it takes a Postgres advisory lock, so if Render ever runs more than one
# instance through this script concurrently, the second just waits and
# then finds nothing pending.
#
# `exec` replaces this script's process with the actual Next.js server
# instead of running it as a child — so the container's PID 1 ends up
# being Node itself, and SIGTERM reaches it directly instead of being
# swallowed by a wrapper shell.
set -e

echo "[start] applying database migrations..."
pnpm --filter @frodocodo/db run migrate:deploy

echo "[start] migrations applied, starting Next.js..."
exec node_modules/.bin/next start
