#!/bin/sh
# Container entrypoint (invoked by the Dockerfile's CMD, from WORKDIR
# /app/apps/web): hand off directly to Next.js.
#
# Deliberately does NOT run `prisma migrate deploy` here. For the current
# milestone the target Neon database is already migrated and seeded, and
# migrations are applied manually (see docs/deployment.md) rather than on
# every container start — that keeps this service's only required secret
# to DATABASE_URL, with no direct/non-pooled connection string needed at
# runtime. If automatic migrate-on-start is reintroduced later, `prisma
# migrate deploy` is still safe to run redundantly / from concurrent
# instances (it takes a Postgres advisory lock), but that's a deliberate
# future decision, not the current one — see docs/deployment.md's
# "Migrations" section.
#
# `exec` replaces this script's process with the actual Next.js server
# instead of running it as a child — so the container's PID 1 ends up
# being Node itself, and SIGTERM reaches it directly instead of being
# swallowed by a wrapper shell.
set -e

echo "[start] starting Next.js..."
exec node_modules/.bin/next start
