#!/bin/sh
# Container entrypoint (invoked by the Dockerfile's CMD, from WORKDIR
# /app/apps/web): apply any pending migrations, then hand off to Next.js.
#
# `prisma migrate deploy` is safe to run on every container start, even
# with multiple instances starting concurrently during a deploy: it takes
# a Postgres advisory lock while applying migrations, so a second instance
# starting at the same moment just waits for the first to finish and then
# sees "no pending migrations" rather than racing it. That's what makes
# running it here safe if this service is ever scaled beyond Render's free
# single-instance tier, without needing a separate pre-deploy/release-phase
# mechanism. See docs/deployment.md.
#
# `exec` on the final line replaces this script's process with the actual
# Next.js server instead of running it as a child — so the container's PID 1
# ends up being Node itself, and SIGTERM reaches it directly instead of
# being swallowed by a wrapper shell.
set -e

echo "[start] applying pending migrations..."
/app/packages/db/node_modules/.bin/prisma migrate deploy --schema=/app/packages/db/prisma/schema.prisma

echo "[start] starting Next.js..."
exec node_modules/.bin/next start
