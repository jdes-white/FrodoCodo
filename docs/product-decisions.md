# Product decision log

This build followed a 60-section specification (household financial OS,
budgeting-focused V1). This log records the decisions made along the way —
what was decided, by whom, and why — so a future session doesn't relitigate
them without new information.

## Decisions made by the owner (explicitly asked)

Three genuinely product-level questions were raised before implementation
began, since they materially changed scope and couldn't be inferred from the
spec alone:

1. **Tenancy scope: single household vs. multi-household public product.**
   → **Single household.** The domain model still supports multiple
   households (nothing hardcodes a household ID), but there's no public
   registration/invite flow — the household is created directly by the seed
   script. Revisit if this ever needs to serve more than one family.

2. **Live integrations this session: mock everything, or wire real
   Anthropic/Basiq credentials?** → **Mock/stub both.** `MockProvider`
   generates the synthetic dataset; `AI_PROVIDER` defaults to `stub`
   (deterministic templates, no LLM credentials needed). Both are one
   environment-variable change away from the real thing — see
   `docs/provider-integration.md` and `docs/ai-architecture.md`.

3. **Deploy live hosting this session, or leave it as a runnable
   codebase?** → **Codebase only, at the time this decision was logged.**
   Since then the repo has been prepared for deployment as a Docker image on
   Render, backed by Neon Postgres — see `docs/deployment.md` for the current
   architecture and the owner's one remaining setup step. (An earlier Vercel
   deployment was tried and deliberately abandoned; do not reintroduce it —
   see `docs/deployment.md`'s "Vercel was tried and deliberately abandoned"
   section.)

## Engineering decisions made without asking (routine, per the spec's own instruction not to escalate these)

- **Stack**: Next.js 15 (App Router) + TypeScript + Tailwind v4, PostgreSQL +
  Prisma, pnpm workspaces. See `docs/architecture.md` for the full reasoning
  table.
- **Auth**: a hand-rolled signed-JWT session cookie (`jose` + `bcryptjs`)
  instead of a full auth framework (Auth.js/NextAuth). Reasoning: two known
  household users, no social login, no multi-tenant signup flow — a full
  auth framework's surface area (adapters, providers, session strategies)
  wasn't buying anything a ~100-line module with httpOnly signed cookies
  doesn't already provide. Revisit if the tenancy-scope decision above ever
  flips to multi-household with public signup, where framework-provided
  email verification/password reset flows would earn their complexity.
- **Background jobs**: a plain `setInterval` loop in `apps/worker` instead of
  a durable queue (pg-boss/BullMQ). Reasoning: single-instance,
  household-scale deployment doesn't need distributed job coordination; the
  interval loop is simpler to read, run, and test. Documented as a
  known limitation in `CLAUDE.md` — swap it if this ever needs multiple
  worker instances.
- **Financial provider**: Basiq recommended for real integration (see
  `docs/provider-integration.md`) after actually researching current
  Australian CDR aggregator coverage rather than assuming it — this
  surfaced a real, non-obvious finding: **American Express Australia is not
  yet a CDR data holder** (non-bank lenders join CDR from 9 November 2026),
  so it needs a credential-based fallback pathway today, while CBA and
  Virgin Money Australia are both reachable via CDR now (Virgin Money with
  the precondition that the card is registered in their own app first).
- **Insight detector scope**: implemented projected overspend, unusual
  category increase, spending spike, recurring/subscription detection,
  unusually large transaction, and duplicate-looking charge (6 of the 15
  detector types listed in §26). The remaining ones (income change,
  fixed-cost change, forgotten subscription, period-over-period comparison,
  seasonality-aware detectors) are natural extensions of the same pattern
  (`packages/domain/src/insightDetectors.ts`) — not implemented yet because
  they need more historical data than a 4-month synthetic dataset
  meaningfully exercises, not because of any architectural blocker.
- **Onboarding wizard**: the 17-step onboarding flow from §28 is not built
  as an interactive UI. Because tenancy scope is single-household (decision
  #1 above), the seed script performs the equivalent setup non-interactively
  (household, categories, budget, connected accounts, initial
  classification) — building a wizard UI for a flow that only ever runs
  once, non-interactively, for this build's scope would have been effort
  spent on UI that doesn't serve the current product decision. Worth
  building if tenancy scope ever changes.

## Known gaps (flagged, not hidden)

See `CLAUDE.md`'s "Known limitations" section and `docs/security-privacy.md`'s
"explicitly out of scope" section for the full list — summarized:

- No password reset flow.
- Insight rows are never expired/dismissed automatically once the condition
  that triggered them stops being true.
- Rate limiting and structured PII-safe logging aren't implemented (fine for
  single-household local use; needed before any multi-tenant or public
  deployment).
- ~~`Transaction.rawProviderPayload` should be encrypted at rest before a
  real provider integration goes live with real accounts.~~ Superseded by
  Task 6B: the column was removed entirely rather than encrypted — data
  FrodoCodo never retains cannot later leak, which is a stronger guarantee
  than encryption-at-rest. See `docs/banking-data-minimisation-audit.md`.
- 9 of 15 spec-listed insight detector types aren't implemented (see above).

## Non-negotiables preserved throughout

The spec's 13 non-negotiable engineering principles (§57) are restated and
mapped to concrete code in `CLAUDE.md` — that file, not this one, is what a
future session should read before making a change that might violate one of
them (especially #1-4: deterministic calculations, LLM-never-computes,
double-counting prevention, and traceability).
