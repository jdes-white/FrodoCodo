# AI architecture

## Two separate things named "AI"

**Claude Code** built this repository. It is not part of the running
product and has no runtime role.

**The runtime LLM** (Anthropic Claude, called from `packages/ai`) powers the
in-app AI coach and insight narratives. It is a production dependency of the
*explanation* layer only — never the calculator.

## FinancialIntelligenceService

`packages/ai/src/financialIntelligenceService.ts` is the only way anything in
this codebase talks to an LLM. It:

1. Accepts an `IntelligenceRequest` (`type`, a `FinancialFactSheet`, and
   optionally a household question or an insight title to explain).
2. Calls the configured `ModelGateway.generateNarrative(request)`.
3. Validates the response against a zod schema (`NarrativeResponseSchema`).
4. Validates that **every dollar figure in the response text already exists
   somewhere in the fact sheet** (`narrativeCitesOnlyKnownFigures`,
   `packages/ai/src/factSheet.ts`) — this is what stops a model from
   inventing or miscalculating a number.
5. On any failure (schema mismatch, unknown figure, thrown error, provider
   timeout), falls back to a deterministic template
   (`StubGateway.generateNarrative`) built from the same fact sheet — so the
   household always gets an answer, and the AI provider is never a single
   point of failure for the dashboard (§44).

## Context generation (§22)

`FinancialFactSheet` (`packages/ai/src/factSheet.ts`) is deliberately
minimal: budget period dates/progress, total and per-bucket
allocation/spent/remaining/status/projection, and optionally a short list of
notable transactions or comparisons — all pre-formatted as AUD strings by
the caller (`apps/web/lib/factSheetBuilder.ts`). No raw account numbers, no
full transaction history, no PII beyond what's needed for the specific
question. This is what gets sent to Anthropic, not the household's
database.

## Model gateway

`ModelGateway` is a one-method interface (`generateNarrative`). Two
implementations exist:

- **`StubGateway`** (default, `AI_PROVIDER=stub`) — a deterministic template
  using the same phrasing conventions the spec asked for ("at your current
  rate...", "the data shows..."). Zero network calls, zero credentials. This
  is what runs in this repo out of the box.
- **`AnthropicGateway`** (`AI_PROVIDER=anthropic` + `ANTHROPIC_API_KEY`) —
  calls the real Claude Messages API server-side, with a system prompt that
  explicitly instructs the model to restate the fact sheet's numbers rather
  than compute new ones, and to prefer scenario/observational language over
  personalized financial, tax, credit, or investment advice (§25).

Switching between them is a config change (`apps/web/lib/aiGateway.ts`
picks the gateway based on env vars) — no caller code changes.

## Where AI shows up in the product

- **Insights page** (§23) — deterministic findings from
  `packages/domain`'s insight detectors, displayed as-is (no LLM required to
  see them). An "Ask about your budget" box (§24) sends a free-text question
  through `FinancialIntelligenceService`.
- **Nowhere on the dashboard.** The home screen has no AI chrome, per §17 —
  AI is one tap away (Insights), never the first thing the household sees.

## Response validation in depth (§45)

Structured output is required (a JSON object with a single `narrative`
string field today; extend the schema rather than parsing free text if a
future feature needs more fields). Malformed responses are rejected outright
— they never reach the UI. Numeric claims are checked against the fact
sheet's own formatted values, not re-parsed and re-validated arithmetically,
because the fact sheet **is** the authoritative source; the model is only
ever allowed to repeat it.

## Adding a new AI-backed feature

1. Compute whatever deterministic facts the feature needs (in `packages/domain`
   if it's new math, or by composing existing snapshot functions).
2. Build a `FinancialFactSheet` (or extend it) from those facts — formatted
   strings only, nothing the model could misquote into a wrong number.
3. Call `FinancialIntelligenceService.respond(...)`. Do not call
   `ModelGateway` or the Anthropic SDK directly from a route/page.
