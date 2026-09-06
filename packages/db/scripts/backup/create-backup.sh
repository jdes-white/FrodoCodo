#!/usr/bin/env bash
# Creates one encrypted, independently-restorable backup of the FrodoCodo
# database (security audit finding C3 — Neon's own point-in-time recovery
# is capped at 6 hours on the Free plan, so this is the independent,
# longer-retention half of the recovery story).
#
# Deliberately a plain bash script using only pg_dump/psql/openssl/jq —
# every one of those is preinstalled on GitHub Actions' ubuntu-latest
# runners and on this repo's own local dev images, so nothing new needs
# installing to run or test this. See docs/backup-recovery.md for the full
# design rationale, retention policy, and restore procedure.
#
# Never prints the connection string, the encryption key, or any row data
# — only table names, counts, and byte sizes, none of which are financial
# data.
#
# Inputs (env vars):
#   BACKUP_SOURCE_DATABASE_URL  (required) Postgres connection string to back up.
#                                Use Neon's DIRECT (non-pooled) URL in production —
#                                pg_dump needs one stable session, and PgBouncer's
#                                transaction-pooling mode (what DATABASE_URL points
#                                at) doesn't support that.
#   BACKUP_ENCRYPTION_KEY       (required) Passphrase used to encrypt the dump.
#   BACKUP_OUTPUT_DIR           (optional) Where to write the two output files.
#                                Defaults to ./backup-output.
#
# Outputs (in BACKUP_OUTPUT_DIR):
#   db-backup-<UTC timestamp>.dump.enc       — AES-256-CBC-encrypted pg_dump
#                                               (custom format) of the whole database.
#   db-backup-<UTC timestamp>.manifest.json  — unencrypted, non-sensitive: per-table
#                                               row counts, dump byte size, latest
#                                               applied Prisma migration, timestamp.
#                                               Used to verify a restore later without
#                                               needing to decrypt anything first.
#
# Exits non-zero (and leaves no output files behind) on any failure —
# a partial or corrupt backup must never be mistaken for a good one.

set -euo pipefail

: "${BACKUP_SOURCE_DATABASE_URL:?BACKUP_SOURCE_DATABASE_URL is required}"
: "${BACKUP_ENCRYPTION_KEY:?BACKUP_ENCRYPTION_KEY is required}"
BACKUP_OUTPUT_DIR="${BACKUP_OUTPUT_DIR:-./backup-output}"

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT

dump_file="$workdir/db.dump"
manifest_file="$workdir/manifest.json"
bundle_file="$workdir/bundle.tar"

echo "[backup] Starting backup at $timestamp"

echo "[backup] Dumping database (custom format, compressed)..."
pg_dump "$BACKUP_SOURCE_DATABASE_URL" --format=custom --compress=9 --no-owner --no-privileges --file="$dump_file"

dump_bytes="$(stat -c%s "$dump_file" 2>/dev/null || stat -f%z "$dump_file")"
echo "[backup] Dump written: ${dump_bytes} bytes"

# A near-empty dump almost certainly means something went wrong upstream
# (wrong connection string, empty database, network truncation) rather
# than a legitimately tiny household database — fail loudly instead of
# quietly archiving nothing useful.
min_dump_bytes=2048
if [ "$dump_bytes" -lt "$min_dump_bytes" ]; then
  echo "[backup] ERROR: dump is only ${dump_bytes} bytes (expected at least ${min_dump_bytes}) — refusing to treat this as a valid backup." >&2
  exit 1
fi

echo "[backup] Verifying dump is a well-formed, readable archive..."
if ! pg_restore --list "$dump_file" > "$workdir/toc.txt" 2>"$workdir/toc.err"; then
  echo "[backup] ERROR: pg_restore could not read the table of contents from the dump — it is corrupt or truncated." >&2
  cat "$workdir/toc.err" >&2
  exit 1
fi
toc_entries="$(wc -l < "$workdir/toc.txt" | tr -d ' ')"
if [ "$toc_entries" -lt 1 ]; then
  echo "[backup] ERROR: dump's table of contents is empty." >&2
  exit 1
fi
echo "[backup] Dump verified: ${toc_entries} entries in table of contents."

echo "[backup] Building manifest (table names + row counts — no row data)..."
tables="$(psql "$BACKUP_SOURCE_DATABASE_URL" -tAc "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;")"

manifest_tables="[]"
while IFS= read -r table; do
  [ -z "$table" ] && continue
  count="$(psql "$BACKUP_SOURCE_DATABASE_URL" -tAc "SELECT count(*) FROM \"public\".\"${table}\";")"
  manifest_tables="$(echo "$manifest_tables" | jq --arg t "$table" --argjson c "$count" '. + [{"table": $t, "rowCount": $c}]')"
done <<< "$tables"

latest_migration="$(psql "$BACKUP_SOURCE_DATABASE_URL" -tAc "SELECT migration_name FROM \"_prisma_migrations\" WHERE finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 1;" 2>/dev/null || echo "unknown")"

jq -n \
  --arg timestamp "$timestamp" \
  --arg latestMigration "$latest_migration" \
  --argjson dumpBytes "$dump_bytes" \
  --argjson tableCount "$(echo "$manifest_tables" | jq 'length')" \
  --argjson tables "$manifest_tables" \
  '{
    timestamp: $timestamp,
    latestMigration: $latestMigration,
    dumpBytes: $dumpBytes,
    tableCount: $tableCount,
    tables: $tables
  }' > "$manifest_file"

echo "[backup] Manifest built: $(echo "$manifest_tables" | jq 'length') tables."

echo "[backup] Bundling dump + manifest..."
tar -cf "$bundle_file" -C "$workdir" "$(basename "$dump_file")" "$(basename "$manifest_file")"

mkdir -p "$BACKUP_OUTPUT_DIR"
encrypted_path="$BACKUP_OUTPUT_DIR/db-backup-${timestamp}.dump.enc"
manifest_path="$BACKUP_OUTPUT_DIR/db-backup-${timestamp}.manifest.json"

echo "[backup] Encrypting bundle (AES-256-CBC, PBKDF2)..."
openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt \
  -pass env:BACKUP_ENCRYPTION_KEY \
  -in "$bundle_file" \
  -out "$encrypted_path"

cp "$manifest_file" "$manifest_path"

echo "[backup] Done."
echo "[backup] Encrypted backup: $encrypted_path ($(stat -c%s "$encrypted_path" 2>/dev/null || stat -f%z "$encrypted_path") bytes)"
echo "[backup] Manifest (unencrypted, no financial data): $manifest_path"
