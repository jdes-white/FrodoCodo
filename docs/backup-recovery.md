# Backup & recovery

Closes security audit finding **C3** (recovery/backup readiness): Neon's
Free-plan point-in-time recovery (PITR) only covers the last **6 hours**,
which isn't enough if corruption or a bad deletion is noticed later than
that. This document describes the independent, longer-retention backup
system that sits alongside Neon's own PITR — together:

- **Neon PITR (6 hours)** — recent, second-granularity recovery for
  anything caught quickly. Unchanged by this work; the household's plan
  was deliberately not upgraded to get more of it (see the Task 5 brief).
- **Independent daily backups (this document)** — coarser (daily) but
  much longer-retention (30 days) recovery for anything noticed later.

## Architecture

A GitHub Actions workflow (`.github/workflows/backup.yml`) runs on a
schedule, entirely on GitHub's infrastructure — no Render or Neon plan
change, no new paid service:

1. **Dump.** `pg_dump` (custom format, compressed) against Neon's
   **direct** connection string — the same kind of URL Render's own
   `DIRECT_URL` uses, for the same reason (`pg_dump` needs one stable
   session; PgBouncer's transaction-pooling mode, what the app's
   `DATABASE_URL` points at, doesn't support that).
2. **Manifest.** A small, non-sensitive JSON file recording the backup's
   timestamp, the latest applied Prisma migration, the dump's byte size,
   and — for every table — its row count. No row data, no financial
   figures, nothing that needs protecting on its own.
3. **Integrity check.** Before anything is encrypted or uploaded, the dump
   is confirmed non-trivially-sized and its table of contents is read back
   with `pg_restore --list` — a truncated or corrupt dump fails the job
   immediately.
4. **Encrypt.** The dump + manifest are bundled and encrypted with
   AES-256-CBC (`openssl enc -pbkdf2 -iter 200000`), keyed by a passphrase
   that exists only as a GitHub Actions secret — never in this repo,
   never logged.
5. **Restore-test, every single run.** The encrypted backup is
   immediately decrypted and restored into a **disposable Postgres
   service container** that exists only for the duration of that one
   workflow run — never production, never anything persistent — and then
   verified structurally and by exact row count against the manifest
   (`packages/db/scripts/backup/verify-database.sh`). **A backup that
   fails this check is never published.** This is what makes a bad backup
   detectable instead of silently "successful," and it means every
   backup that does get published has already been proven restorable —
   not just assumed to be.
6. **Publish.** Only after that passes: the encrypted file + manifest are
   uploaded as a GitHub Release in a **separate, private** companion
   repository, `jdes-white/frodocodo-backups` — never in the main
   `FrodoCodo` repo, which is public. A backup of household financial
   data must not be publicly downloadable, encrypted or not.
7. **Prune.** Releases beyond the retention window (see below) are
   deleted — but only *after* a new backup has been confirmed good, so a
   bad run never reduces how many good backups exist.

Every step that could reveal financial data or secrets is written to
print only table names, row counts, byte sizes, and pass/fail — see
`packages/db/scripts/backup/*.sh` for the exact log lines. The connection
string and encryption key are never echoed anywhere.

## Retention

**Simple rolling retention: the most recent 30 daily backups (~1 month),
nothing more elaborate.** For a private two-user household application,
this is judged sufficient — it covers "we didn't notice a problem for a
few weeks," which is the gap Neon's 6-hour PITR can't cover on its own.
Revisit only if real usage ever demonstrates a need for longer retention
(e.g. a monthly rollup kept for a year); there's no reason to build that
before it's needed.

## Required secrets (GitHub Actions, on the `FrodoCodo` repo)

| Secret | Value | Purpose |
|---|---|---|
| `BACKUP_SOURCE_DATABASE_URL` | Neon's **direct** (non-pooled) connection string — the exact same value already given to Render as `DIRECT_URL` | What the backup workflow dumps from |
| `BACKUP_ENCRYPTION_KEY` | A random 32+ byte passphrase, e.g. `openssl rand -base64 32` | Encrypts/decrypts every backup |
| `BACKUP_REPO_TOKEN` | A GitHub fine-grained personal access token, scoped **only** to `jdes-white/frodocodo-backups`, with **Contents: Read and write** permission | Lets this repo's workflow create Releases in the separate private backups repo (the default per-run `GITHUB_TOKEN` can't reach a different repository) |

None of these are committed anywhere — they exist only as GitHub Actions
repository secrets, which GitHub Actions itself never exposes in logs
(secret values are automatically redacted from workflow output).

**`BACKUP_ENCRYPTION_KEY` cannot be recovered if lost** — GitHub secrets
are write-only (nothing, including this workflow, can read a secret's
value back out). Store the exact value you generate in a password manager
the moment you create it. Losing it means every existing backup becomes
permanently undecryptable — it does not put the app or the live database
at any risk, but it does mean starting the backup history over with a new
key.

## Human setup steps (not something an agent session can do)

Creating a new repository and generating personal-access-token /
repository-secret values are dashboard/account actions no code-writing
session has permission to perform. To make this system live:

1. **Create a new private GitHub repository**, e.g.
   `jdes-white/frodocodo-backups`. Private is required — the main repo is
   public, so a companion repo is where the encrypted backups actually
   live (see "Architecture" above). It never needs any files or GitHub
   Actions of its own; it only ever receives Releases pushed from this
   repo's workflow.
2. **Generate a fine-grained personal access token** (GitHub → Settings →
   Developer settings → Personal access tokens → Fine-grained tokens):
   scope it to **only** the new `frodocodo-backups` repository, with
   repository permission **Contents: Read and write**. Nothing else.
3. **Generate the encryption key**: `openssl rand -base64 32`. Save this
   value in a password manager immediately — see the warning above.
4. **Add three repository secrets** on the `FrodoCodo` repo (Settings →
   Secrets and variables → Actions → New repository secret):
   - `BACKUP_SOURCE_DATABASE_URL` — Neon's direct connection string (same
     value as Render's `DIRECT_URL`).
   - `BACKUP_ENCRYPTION_KEY` — the value from step 3.
   - `BACKUP_REPO_TOKEN` — the token from step 2.
5. **Confirm GitHub Actions is enabled** for the `FrodoCodo` repo
   (Settings → Actions → General) — it is by default for a repo you own.
6. Optionally run the workflow once by hand (Actions tab →
   "Database backup" → "Run workflow") to confirm it succeeds before
   waiting for the first scheduled run.

Until these steps are done, `.github/workflows/backup.yml` exists and is
scheduled, but every run will fail at whichever secret is still missing —
that failure is visible in the repo's Actions tab and (by GitHub's
default notification behavior) emailed to the repo's watchers, so a
missing setup step is loud, not silent.

## Restore procedure (real disaster recovery)

**Never restore directly over the production database.** Always restore
into an isolated target first, confirm it looks right, and only then
decide how to bring that data back into production (see "Promoting a
restore to production" below) — restoring straight into the live database
would overwrite whatever is currently there, including anything that
happened after the backup was taken.

1. **Create an isolated target.** The simplest option on Neon's free plan
   is a **Neon branch** — Neon branching creates a full, separate copy of
   the database (schema + data as of the branch point, or empty if
   branched from before any data existed) with its own connection string,
   at no extra cost on the free tier, and does not affect the primary
   branch. In the Neon dashboard: your project → **Branches** → **Create
   branch** → give it a throwaway name like `restore-test-<date>`. Copy
   its connection string.
   - Alternative: a scratch Postgres database anywhere else (local, a
     fresh Neon project, etc.) — anything you're not relying on.
2. **Download the backup** you want to restore from
   `github.com/jdes-white/frodocodo-backups` → Releases — grab both the
   `.dump.enc` file and its matching `.manifest.json` from the same
   release.
3. **Restore it**, from a checkout of this repo:
   ```bash
   export RESTORE_TARGET_DATABASE_URL="<the isolated target's connection string>"
   export BACKUP_ENCRYPTION_KEY="<the value from your password manager>"
   bash packages/db/scripts/backup/restore-backup.sh path/to/db-backup-TIMESTAMP.dump.enc
   ```
4. **Verify it**:
   ```bash
   bash packages/db/scripts/backup/verify-database.sh path/to/db-backup-TIMESTAMP.manifest.json
   ```
   This confirms every table exists and every row count matches exactly
   what was true at backup time — a clean `PASSED` line means the restore
   is structurally sound.
5. **Inspect it** — log into the restored database (`psql
   "$RESTORE_TARGET_DATABASE_URL"`, or point a local `pnpm dev` at it via
   `DATABASE_URL`/`DIRECT_URL`) and confirm the data itself looks right
   for whatever you were investigating.

### Promoting a restore to production

This is a deliberate, manual, one-off decision — never automated — because
it means discarding whatever is currently in production between the
backup's timestamp and now. Once you've confirmed the restored data (steps
above) is what you want:

1. Take the production database's connection string offline from the app
   temporarily if practical (or accept a short window of inconsistency).
2. Run the exact same `restore-backup.sh` command as above, but with
   `RESTORE_TARGET_DATABASE_URL` pointed at the **real** production Neon
   connection string this time. `pg_restore --clean --if-exists` (used
   internally) drops and recreates each object as it restores, so this
   correctly replaces production's current state with the backup's.
3. Run `verify-database.sh` against production immediately after, using
   the same manifest, to confirm the restore landed correctly.
4. Run `prisma migrate deploy` if any migrations have shipped since the
   backup was taken (the restored schema will be exactly as of the backup
   — any newer migrations need to be re-applied on top).

## Restore test performed (proof this works)

Two layers of proof exist: an initial local dry run of the mechanism, and
a full production run of the actual GitHub Actions workflow once the
required secrets and companion repository existed.

### Local dry run (mechanism proof, pre-secrets)

Before any production secrets existed, a full backup → restore → verify
cycle was run against this repo's local development database as a
stand-in for production:

1. `create-backup.sh` against the local seeded demo database — produced a
   ~120KB encrypted backup covering all 28 tables (162 transactions, 127
   classifications, 76 audit events, etc.).
2. A **new, separate** local database (`frodocodo_restore_test`) was
   created — the working development database was never touched, matching
   the "never overwrite production" requirement even in this test.
3. `restore-backup.sh` decrypted and restored the backup into that new,
   isolated database.
4. `verify-database.sh` confirmed all 28 tables and every row count
   matched the manifest exactly: **PASSED**.
5. Three failure scenarios were also deliberately triggered, to prove a
   bad backup is actually detected rather than silently accepted:
   - Restoring with the **wrong encryption key** — `restore-backup.sh`
     failed loudly (`bad decrypt`), exit code 1.
   - Restoring a **truncated/corrupted** backup file — failed loudly
     (`wrong final block length`), exit code 1.
   - **Deleting rows** from the restored database before verifying —
     `verify-database.sh` correctly reported the exact row-count
     mismatches (including a cascaded foreign-key effect) and exited
     non-zero.
6. The temporary test database was dropped afterward.

### Real production run (the actual workflow, against real Neon)

Once `BACKUP_SOURCE_DATABASE_URL`, `BACKUP_ENCRYPTION_KEY`, and
`BACKUP_REPO_TOKEN` were configured as repository secrets and the private
`jdes-white/frodocodo-backups` companion repository existed, the real
`.github/workflows/backup.yml` was triggered by hand (`workflow_dispatch`)
against the real production Neon database and run to completion multiple
times while fixing issues surfaced along the way (client/server major
version mismatch, `PATH` precedence for the installed Postgres 17 client
tools, a first-run-only empty-target-repo case, and a `schedule`-trigger
branch-pinning issue — see the commit history and the comments in
`backup.yml` itself for each). The final, fully-fixed workflow definition
has now completed successfully end-to-end against real production Neon,
confirming:

- **Connect & dump**: `pg_dump` (client 17, matching Neon's server version
  17.11) connected read-only to production via `BACKUP_SOURCE_DATABASE_URL`
  and produced a valid custom-format dump, confirmed by `pg_restore
  --list` reading back its table of contents.
- **Manifest**: a non-sensitive manifest (table names, row counts,
  timestamp, latest applied Prisma migration) was generated and matched
  the dump's actual contents.
- **Encrypt**: the dump + manifest were bundled and AES-256-CBC encrypted.
- **Restore into a disposable, isolated environment**: the exact encrypted
  artifact just produced was decrypted and restored into a fresh
  `postgres:17-alpine` service container that exists only for that one
  workflow run and is destroyed immediately after — never production,
  never anything persistent.
- **Structural + row-count verification**: `verify-database.sh` confirmed
  **all 28 production tables** were present in the restored database with
  **exactly matching row counts** for every one of them — zero
  discrepancies.
- **Publish**: the verified encrypted backup and its manifest were
  published as a GitHub Release in the private `frodocodo-backups`
  companion repository, confirmed to exist there and confirmed the
  repository's visibility is `private`.
- **Retention/pruning**: the prune step ran and correctly reported nothing
  to delete while under the 30-backup retention limit — confirmed
  operational, not just present in code.
- **No secret exposure**: at no point did any workflow log, job output, or
  this session's own output print, echo, or retrieve the value of
  `BACKUP_SOURCE_DATABASE_URL`, `BACKUP_ENCRYPTION_KEY`, or
  `BACKUP_REPO_TOKEN` — GitHub Actions redacts configured secrets from all
  log output automatically, confirmed by inspecting the actual job logs.

The production database was never written to, restored into, or modified
at any point during this process — only read from, via a single `pg_dump`
per run.

## Threat model / what this does and doesn't cover

**Covers:** accidental deletion, data corruption, a bad migration, or any
other change to the database's *contents* that isn't caught within 6
hours — recoverable back to any of the last 30 daily backup points.

**Does not cover:** the Neon project or account itself being deleted or
compromised (backups live in a separate GitHub account/repo, so this is
already reasonably independent, but a fully offline/3rd-party copy is a
further step not taken here — not judged necessary at this scale); a
compromise of the `BACKUP_ENCRYPTION_KEY` itself (rotate it — see below —
if that's ever suspected); GitHub itself being unavailable (the backups
live only on GitHub — again, judged an acceptable dependency for a
private two-user household app rather than a reason to add a second,
different storage provider).

## Rotating the encryption key

If `BACKUP_ENCRYPTION_KEY` is ever suspected compromised: generate a new
one (`openssl rand -base64 32`), update the `BACKUP_ENCRYPTION_KEY`
repository secret, and note that **backups taken before the rotation can
only be decrypted with the old key** — keep the old value in the password
manager (labeled clearly, e.g. "FrodoCodo backup key — retired
YYYY-MM-DD") until every backup encrypted with it has aged out of the
30-day retention window, or you no longer need to restore from that
period.
