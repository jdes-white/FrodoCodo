#!/usr/bin/env bash
# Structural + row-count verification of a just-restored database against
# the manifest captured at backup time — this is what turns "pg_restore
# exited 0" into an actual guarantee that the restore is usable, and what
# makes a bad backup detectable rather than silently treated as good (a
# backup whose restore fails this check is never published — see
# .github/workflows/backup.yml).
#
# Checks:
#   1. Every table listed in the manifest exists in the target database.
#   2. No unexpected extra/missing tables versus the manifest.
#   3. Every table's row count matches the manifest exactly.
#
# Never prints row data — only table names and counts (never financial
# data).
#
# Inputs (env vars):
#   RESTORE_TARGET_DATABASE_URL  (required) The database to verify.
#
# Arguments:
#   $1  Path to the manifest.json to verify against.
#
# Exits non-zero if anything doesn't match.

set -euo pipefail

: "${RESTORE_TARGET_DATABASE_URL:?RESTORE_TARGET_DATABASE_URL is required}"
manifest_path="${1:?Usage: verify-database.sh <path-to-manifest.json>}"

if [ ! -f "$manifest_path" ]; then
  echo "[verify] ERROR: manifest file $manifest_path does not exist." >&2
  exit 1
fi

echo "[verify] Verifying restored database against $manifest_path..."

expected_tables="$(jq -r '.tables[].table' "$manifest_path" | sort)"
actual_tables="$(psql "$RESTORE_TARGET_DATABASE_URL" -tAc "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;" | sort)"

if [ "$expected_tables" != "$actual_tables" ]; then
  echo "[verify] ERROR: restored table set does not match the manifest." >&2
  echo "--- expected ---" >&2
  echo "$expected_tables" >&2
  echo "--- actual ---" >&2
  echo "$actual_tables" >&2
  exit 1
fi
table_count="$(echo "$expected_tables" | grep -c . || true)"
echo "[verify] Table set matches manifest ($table_count tables)."

mismatches=0
while IFS=$'\t' read -r table expected_count; do
  [ -z "$table" ] && continue
  actual_count="$(psql "$RESTORE_TARGET_DATABASE_URL" -tAc "SELECT count(*) FROM \"public\".\"${table}\";")"
  if [ "$actual_count" != "$expected_count" ]; then
    echo "[verify] MISMATCH: table \"$table\" expected $expected_count rows, found $actual_count." >&2
    mismatches=$((mismatches + 1))
  else
    echo "[verify] OK: \"$table\" — $actual_count rows."
  fi
done < <(jq -r '.tables[] | "\(.table)\t\(.rowCount)"' "$manifest_path")

if [ "$mismatches" -gt 0 ]; then
  echo "[verify] FAILED: $mismatches table(s) had a row-count mismatch." >&2
  exit 1
fi

echo "[verify] PASSED: structure and row counts match the manifest exactly."
