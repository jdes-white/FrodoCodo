# Security & privacy

## Authentication & sessions

Hand-rolled, signed session cookie (`apps/web/lib/session.ts`):

- Password hashing: `bcryptjs`, 12 salt rounds.
- Session: HS256-signed JWT (via `jose`) stored in an `httpOnly`,
  `sameSite: lax`, `secure` (in production) cookie, 14-day expiry.
- Every protected server component/action calls `requireSession()` (or
  `requireAdmin()` for admin-only mutations) — there is no client-side-only
  route guard; the check happens server-side on every request.
- No password reset flow exists yet — this is a real V1 gap for a
  household with only two users provisioned via the seed script; see
  `docs/product-decisions.md`.

This was a deliberate choice over pulling in a full auth framework
(Auth.js/NextAuth) — see `docs/product-decisions.md` for the reasoning. It
is *not* a reason to skip the standard controls: httpOnly cookies, signed
tokens, bcrypt hashing, and server-side checks on every request are all
present.

## Household data isolation

Every database query in `apps/web/lib` and `apps/worker/src` scopes through
`householdId` (directly, or via `connection: { householdId }` for
transaction-adjacent tables). There is no endpoint that returns data without
this filter. If you add a new query, follow the existing pattern — see
`CLAUDE.md` rule 10.

## Secrets

- `DATABASE_URL`, `AUTH_SECRET`, `BASIQ_API_KEY`, `ANTHROPIC_API_KEY` are
  read from environment variables only, never committed (`.env` is
  git-ignored; `.env.example` documents the shape with no real values).
- The Anthropic API key is used exclusively in `packages/ai`'s
  `AnthropicGateway`, instantiated only in server-side code
  (`apps/web/lib/aiGateway.ts`) — never sent to or reachable from the
  client bundle.
- A real `BASIQ_API_KEY` would follow the same pattern: server-side only,
  never in a route that returns to the client.

## What the AI provider sees

See `docs/ai-architecture.md` — a `FinancialFactSheet` (budget totals,
per-bucket status, pre-formatted AUD strings), never raw account numbers,
account identifiers, or full transaction history. This is the "minimum data
required for the requested task" principle from §22/§34.

## Data at rest

Prisma's `Decimal` columns store money precisely (no float drift).
`Transaction.rawProviderPayload` (Json) preserves the original provider
response for audit/debugging — in a production deployment with a real
provider, this column is the highest-sensitivity data in the schema (it may
contain more of the original payload than the normalized fields) and should
be encrypted at the column level (e.g. via `pgcrypto` or an application-level
envelope) before going live with real accounts. This repo does not implement
that encryption yet, since it never stores real financial data — flagged
here so it isn't missed before a real deployment.

## Audit trail

`AuditEvent` rows are written for every admin mutation (reclassification
with rule creation, exclusion toggles, transfer marking, allocation edits,
account inclusion changes, institution disconnection) —
`apps/web/lib/audit.ts`. Each row captures `actorUserId`, `action`,
`entityType`/`entityId`, and a `metadata` JSON blob with just enough detail
to explain *why* a total changed later (§31), never full transaction
descriptions or amounts beyond what's already visible to the actor.

## What's explicitly out of scope for this build

Rate limiting, structured request logging with PII scrubbing, and formal
penetration testing were not implemented — this is a single-household demo
build, not a multi-tenant production service. Before a real multi-household
or public deployment: add rate limiting on `/login` and the AI ask endpoint,
review `apps/web` for any log line that could include a transaction
description or amount, and get a real security review. See
`docs/product-decisions.md` for the tenancy-scope decision that makes this
an acceptable gap for V1.

## Privacy controls surfaced in the product

Settings (`apps/web/app/(app)/settings/page.tsx`) shows, per connected
institution: which CDR/credential pathway it uses, consent status, and a
disconnect action (admin-only) that revokes consent
(`FinancialConnection.consentStatus = REVOKED`, `isActive = false`) rather
than silently continuing to sync. It also states plainly what the AI coach
does and doesn't see, and which provider (stub or Anthropic) is currently
configured.
