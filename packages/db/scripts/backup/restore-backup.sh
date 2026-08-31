#!/usr/bin/env bash
# Decrypts a backup produced by create-backup.sh and restores it into a
# target Postgres database. Deliberately generic and target-agnostic — it
# takes its target from an env var with a name that is never DATABASE_URL
# or DIRECT_URL, specifically so this can never be accidentally pointed at
# the running app's own production connection by inheriting an existing
# .env file. Always double-check RESTORE_TARGET_DATABASE_URL yourself
# before running this — see docs/backup-recovery.md's restore procedure.
#
# This script only ever CREATEs objects into whatever database
# RESTORE_TARGET_DATABASE_URL points at (via pg_restore --clean --if-exists,
# which drops-and-recreates objects *inside that target database*, never
# drops the database itself and never touches any other database on the
# same server) — point it at an empty/isolated database or Neon branch,
# never at a database you need to keep untouched.
#
# Inputs (env vars):
#   RESTORE_TARGET_DATABASE_URL  (required) Postgres connection string to restore INTO.
#   BACKUP_ENCRYPTION_KEY        (required) Same passphrase used to create the backup.
#
# Arguments:
#   $1  Path to the db-backup-<timestamp>.dump.enc file to restore.
#
# Exits non-zero on any failure.

set -euo pipefail

: "${RESTORE_TARGET_DATABASE_URL:?RESTORE_TARGET_DATABASE_URL is required}"
: "${BACKUP_ENCRYPTION_KEY:?BACKUP_ENCRYPTION_KEY is required}"

encrypted_path="${1:?Usage: restore-backup.sh <path-to-db-backup-TIMESTAMP.dump.enc>}"
if [ ! -f "$encrypted_path" ]; then
  echo "[restore] ERROR: $encrypted_path does not exist." >&2
  exit 1
fi

workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT

bundle_file="$workdir/bundle.tar"
dump_file="$workdir/db.dump"

echo "[restore] Decrypting $encrypted_path..."
if ! openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 \
  -pass env:BACKUP_ENCRYPTION_KEY \
  -in "$encrypted_path" \
  -out "$bundle_file" 2>"$workdir/decrypt.err"; then
  echo "[restore] ERROR: decryption failed — wrong BACKUP_ENCRYPTION_KEY, or the file is corrupt." >&2
  cat "$workdir/decrypt.err" >&2
  exit 1
fi

echo "[restore] Extracting dump + manifest..."
tar -xf "$bundle_file" -C "$workdir"
if [ ! -f "$dump_file" ]; then
  echo "[restore] ERROR: bundle did not contain db.dump." >&2
  exit 1
fi
if [ -f "$workdir/manifest.json" ]; then
  cp "$workdir/manifest.json" "$(dirname "$encrypted_path")/$(basename "$encrypted_path" .dump.enc).restored-manifest.json"
fi

echo "[restore] Restoring into target database..."
# --clean --if-exists: drop-and-recreate each object as it's restored, so
# this is safe to re-run against the same target without manual cleanup —
# but only ever *inside* the one database RESTORE_TARGET_DATABASE_URL names.
# --no-owner/--no-privileges: the target's own role may not match the
# source's; ownership/grants aren't meaningful across a restore anyway.
pg_restore \
  --dbname="$RESTORE_TARGET_DATABASE_URL" \
  --clean --if-exists \
  --no-owner --no-privileges \
  --exit-on-error \
  "$dump_file"

echo "[restore] Done. Run verify-database.sh next to confirm the restore matches the manifest."
