#!/bin/sh
# Container entrypoint (invoked by the Dockerfile's CMD, from WORKDIR
# /app/apps/web): apply any pending database migrations, then hand off to
# Next.js — but only if the migration step actually succeeded.
#
# `set -e` is the whole safety mechanism here: `node_modules/.bin/prisma
# migrate deploy` runs first; if it exits non-zero for any reason — a
# broken migration, a missing DIRECT_URL, a database that's briefly
# unreachable — this script exits immediately too, `exec next start` never
# runs, the container never opens its port, and Render's own health check
# (Dockerfile's HEALTHCHECK / render.yaml) never passes. Render's standard
# zero-downtime deploy behaviour then keeps the previous, still-working
# release serving traffic and marks this deploy as failed — see
# docs/deployment.md's "Migrations" section for the full reasoning and why
# this replaced the previous by-hand migration policy.
#
# The `prisma` binary is invoked directly from apps/web's own
# node_modules/.bin (it's a devDependency there — see apps/web/package.json)
# with an explicit --schema path into packages/db, rather than via `pnpm
# --filter @frodocodo/db run migrate:deploy` as originally written. That
# first version broke every production deploy: this container's runtime
# user (Dockerfile's `frodocodo`, a `useradd --system` account with no home
# directory, under a non-writable /home) has nowhere for Corepack to create
# its version-download cache, and invoking `pnpm` at all — even just to run
# a package-local script — routes through Corepack's shim, which tries to
# download/cache the exact `packageManager`-pinned pnpm version from the
# root package.json before it can do anything else. That download's cache
# directory (`$HOME/.cache/node/corepack/v1`) can't be created for this
# user, so the `mkdir` fails and takes the whole container down before
# Next.js ever starts. Calling the already-installed `prisma` binary
# directly (matching how `next start` below is already invoked — see the
# `exec` comment) needs no package manager, no Corepack, and no cache
# directory at all; every dependency it needs is already sitting in
# node_modules from the Docker build.
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
node_modules/.bin/prisma migrate deploy --schema=../../packages/db/prisma/schema.prisma

echo "[start] migrations applied, starting Next.js..."
exec node_modules/.bin/next start
