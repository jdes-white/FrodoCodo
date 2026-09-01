# Basiq provider adapter (Task 7A, corrected in Task 7A.1)

**Status: implemented, never connected.** `packages/providers/src/basiq/`
implements a real Basiq adapter for **CBA and Virgin Money only** behind
the same `FinancialDataProvider` interface MockProvider implements — but
no code in this repository has ever called it against the real Basiq API,
created a real Basiq user, requested real CDR consent, or touched a real
bank account. Every test exercising this adapter injects a scripted mock
HTTP client (`packages/providers/src/basiq/__tests__/`); none contact
`api.basiq.io`. Amex is explicitly out of scope for this adapter — see
`docs/banking-data-minimisation-audit.md` for why it isn't CDR-reachable
yet.

**Research caveat, same as `docs/banking-data-minimisation-audit.md`:**
this sandbox's network egress proxy blocks `api.basiq.io`, `basiq.io`, and
`cdr.gov.au` outright — every `WebFetch` attempt against them during this
task returned `EGRESS_BLOCKED`. Everything below that describes Basiq's
actual API (endpoint paths, exact field names, exact institution IDs, and
scope/consent wire format) is a best-effort model built from search-indexed
summaries of Basiq's own published documentation, not a direct read of the
live reference. Every such claim is flagged inline. **Re-verify all of it
against Basiq's live API reference before this adapter is ever pointed at
a real API key.**

**Task 7A.1 correction pass (this revision):** Task 7A's original
`BASIQ_REQUESTED_DATA_CLUSTERS = ["accounts", "transactions"]` conflated
two genuinely different Basiq concepts — API authentication token scope
and CDR consent-policy scope — into one vocabulary that was neither. This
revision corrects that model, adds a Consent UI URL builder (construction
only, never launched), adds a CLIENT_ACCESS token method, replaces
substring institution-name matching with exact/approved-name matching plus
explicit ambiguity rejection, aligns the transaction-sync filter query with
Basiq's documented filter field names, and adds runtime validation so a
malformed Basiq response is skipped rather than silently mapped into
garbage. See each section below for what changed. **Still no real Basiq
API key, Basiq user, CDR consent, or bank connection was ever used —
same hard stop as Task 7A.**

---

## Architecture

```
packages/providers/src/basiq/
  scopes.ts            -- token scopes + CDR consent-policy scopes + institution allow-list (§2)
  types.ts              -- Basiq response shapes this adapter reads
  httpClient.ts          -- auth (SERVER_ACCESS + CLIENT_ACCESS tokens) + pagination
  institutionMatch.ts    -- resolves CBA/Virgin by exact NAME, fails closed on ambiguity
  consentUi.ts           -- hosted Consent UI URL builder + state generator (construction only)
  basiqProvider.ts      -- the FinancialDataProvider implementation
packages/providers/src/factory.ts  -- createFinancialProvider(): mock | basiq, by env
```

`BasiqProvider` implements exactly the six `FinancialDataProvider` methods
(`listSupportedInstitutions`, `initiateConnection`, `getConsentStatus`,
`discoverAccounts`, `syncTransactions`, `disconnectConnection`) — the same
interface `MockProvider` implements, so nothing outside
`packages/providers` needs to change to use it (§7 of the original spec).
`createFinancialProvider()` (`packages/providers/src/factory.ts`) is the
one place `FINANCIAL_PROVIDER`/`BASIQ_API_KEY` are read; both
`apps/worker` (scheduled sync) and `apps/web`'s disconnect action call it,
so they always instantiate the same adapter rather than duplicating the
provider-selection switch.

Every provider response is mapped into `ProviderAccount`/
`ProviderTransaction` inside `basiqProvider.ts`, then — same as
MockProvider — passed through the Task 6 allow-lists
(`packages/ledger/src/ingestion.ts`'s `toIngestibleAccountFields`/
`toIngestibleTransactionFields`) by the actual ingestion call sites
(`apps/worker/src/syncConnection.ts`, `packages/db/src/seedHousehold.ts`).
**No Basiq response object is ever persisted directly** — proven by
`packages/providers/src/basiq/__tests__/basiqProvider.test.ts`, which maps
a real-shaped Basiq account (with a masked account number and a provider
nickname embedding one) and a real-shaped transaction, then runs the
mapped output through the actual allow-list functions and asserts neither
sensitive field survives.

---

## API token scope vs. CDR consent-policy scope (Task 7A.1 item 1 — corrects Task 7A)

Task 7A's `BASIQ_REQUESTED_DATA_CLUSTERS = ["accounts", "transactions"]`
was a reasonable *intent* expressed in the wrong *vocabulary*, conflating
two genuinely different Basiq concepts into one list. Basiq v3 actually
distinguishes:

1. **API authentication token scope** — `SERVER_ACCESS` / `CLIENT_ACCESS`.
   This IS a literal request parameter this adapter's code sends
   (`scope=SERVER_ACCESS` or `scope=CLIENT_ACCESS` in the `/token`
   exchange — see `httpClient.ts`). It controls which Basiq API
   *endpoints* the resulting bearer token can call at all — it has nothing
   to do with what banking data a household has consented to share.
2. **CDR consent-policy scope** — `bank:accounts.basic:read`,
   `bank:transactions:read`, etc. This is Basiq's own consent-policy
   concept, **configured against the Basiq application in its dashboard**
   (a human, pre-live setup step — see the setup checklist near the bottom
   of this document), and presented to the household when they connect an
   institution. **No line of this adapter's code sends these strings as a
   request parameter** — there is no documented Basiq v3 API call where a
   client passes CDR scope strings directly; they are dashboard
   configuration that determines what the hosted Consent UI asks the
   household to approve.

`packages/providers/src/basiq/scopes.ts` now names both concepts
separately and correctly:

```ts
export const BASIQ_TOKEN_SCOPES = { SERVER: "SERVER_ACCESS", CLIENT: "CLIENT_ACCESS" } as const;

export const BASIQ_CONSENT_POLICY_SCOPES = ["bank:accounts.basic:read", "bank:transactions:read"] as const;

export const BASIQ_REFUSED_CONSENT_POLICY_SCOPES = [
  "bank:accounts.detail:read",     // full/unmasked account number, BSB, detailed product terms
  "common:customer.basic:read",     // customer name
  "common:customer.detail:read",    // address, contact details, DOB
  "bank:payees:read",               // third-party payee names + BSB/account numbers
  "bank:regular_payments:read",     // scheduled payments / direct-debit authority metadata
  "bank:products:read",             // detailed product/card feature metadata not needed for ingestion
] as const;
```

`packages/providers/src/basiq/__tests__/scopes.test.ts` asserts: the two
token scopes are distinct constants; the requested consent-policy scope
set is exactly `["bank:accounts.basic:read", "bank:transactions:read"]`;
none of the refused consent-policy scopes appear in it; and every category
the task named (unmasked account numbers/BSBs, customer identity, payees,
scheduled payments) is explicitly enumerated as refused rather than merely
"not mentioned."

**Server-to-server calls** (institutions, users, connections, accounts,
transactions) authenticate with `SERVER_ACCESS` — full server-to-server
access, obtained by exchanging `BASIQ_API_KEY` and cached in-memory only
(see the token/credential table below).

**The Consent UI launch** requires a separate, restricted, **user-bound**
`CLIENT_ACCESS` token — `BasiqHttpClient.getClientAccessToken(basiqUserId)`
obtains one. Unlike the SERVER token, it is deliberately **never cached or
reused**: it's fetched fresh immediately before building a Consent UI URL
and used for nothing else, so there's no benefit to holding onto it and a
real cost (a longer-lived secret) to doing so. It is never exposed to the
browser directly by this adapter — the resulting URL (built by
`consentUi.ts`) is what a server-rendered redirect would send the
browser to, not the token in isolation.

**Unresolved (do not treat as confirmed):** the exact JSON field name(s)
Basiq's Consent Policy dashboard configuration stores these scope strings
under, and whether `bank:accounts.basic:read` implicitly includes balance
data or is itself sub-divided further. Confirm against Basiq's live
Consent Policy documentation (blocked from this sandbox) before
configuring a real consent policy — see the setup checklist below.

---

## Hosted Consent UI (Task 7A.1 item 3 — construction only, never launched)

Basiq's documented hosted Consent UI pattern is a browser redirect to:

```
https://consent.basiq.io/home?token=<user-bound CLIENT_ACCESS token>&state=<state>[&action=connect]
```

`packages/providers/src/basiq/consentUi.ts` exposes exactly two pure
functions, neither of which fetches or navigates anywhere:

- `generateConsentState()` — a cryptographically strong (32 random bytes,
  base64url-encoded), single-use `state` value a caller generates and
  stores server-side against the in-flight connection attempt, so the
  eventual return/callback can be verified against it — CSRF/mix-up
  protection for the redirect round-trip.
- `buildConsentUiUrl({ clientToken, state, action? })` — builds the URL
  string above. `action: "connect"` is Basiq's documented action for a
  household that already has an active Basiq user/consent and is adding
  **another** institution connection, rather than completing their first
  consent (see the multi-institution model below). Omit it for a
  household's first institution.

Neither function ever logs, throws with, or otherwise surfaces the token
value in an error message — proven by `consentUi.test.ts`. **This task
does not launch the Consent UI or wire it into any route** — the builder
exists so URL construction is correct and tested before that real wiring
happens in a later, sandbox-connected task.

---

## Account fields: transient vs permanently persisted (Task 7A item 4)

| Field | During account discovery (Basiq's real response) | Permanently persisted? |
|---|---|---|
| `id` (Basiq's own account identifier) | Present | **Yes** — as `Account.providerAccountId`, opaque |
| `attributes.name` (Basiq's account nickname — can embed a masked-number fragment, e.g. "Complete Access ...5678") | Present | **No.** Read by `mapBasiqAccount` into `ProviderAccount.displayName` (the interface field a real provider naturally populates) and never read again — `Account.alias` is always separately derived from the institution's short name (`packages/ledger/src/accountAlias.ts`), never from this field. Proven in `basiqProvider.test.ts`. |
| `attributes.accountNo` (masked or full account number) | Present in Basiq's real response (declared in `types.ts` for shape-fidelity) | **No.** Never read by any mapping function in this adapter — not even transiently into a local variable. |
| `attributes.class.type` (Basiq's product classification) | Present | **Yes, reduced** — mapped to FrodoCodo's own coarse `AccountType` enum (`TRANSACTION`/`CREDIT_CARD`/`SAVINGS`/`OTHER`) by `mapAccountType`; Basiq's own class string itself is discarded. |
| `attributes.currency` | Present | **Yes** — a currency code, not identity/account data. |
| `attributes.balance` / `attributes.availableFunds` | Present | **No** (Task 6C data-minimisation review: no currently-required FrodoCodo feature reads a bank balance — "how much is left" is budget-remaining, never account balance). Read into `ProviderAccount.currentBalance`/`availableBalance` (present because a real provider returns them) and then never persisted — `toIngestibleAccountFields` has no slot for either field. |
| BSB, customer name, address, contact details | Never requested (see scope boundary above) | **No** — never in scope, never in the response shape this adapter reads. |

Nothing here is held "transiently in memory across a request boundary and
then discarded later" — every non-persisted field above is read exactly
once, inside the mapping function that receives Basiq's raw response, and
never written to any variable, log, or return value that outlives that
function call.

## Normalized transaction fields persisted

Unchanged from Task 6B/6C's ingestion allow-list
(`packages/ledger/src/ingestion.ts`): `providerTransactionId`,
`transactionDate`, `postingDate`, `amount`, `direction`, `status`,
`originalDescription`, `sourceType`, and the new (Task 7A)
`reversalOfProviderTransactionId` — populated only when a source
explicitly declares a reversal linkage (see "Reversal detection" below).
Basiq's raw transaction object (`BasiqTransaction`) is never persisted;
`mapBasiqTransaction` reads exactly the fields the normalized shape needs
and nothing else survives the mapping call.

---

## Token/credential security (Task 7A item 5)

| Credential | Type | Where stored | Encrypted? | Lifetime | Refresh | Revocation | What an attacker holding it could do |
|---|---|---|---|---|---|---|---|
| `BASIQ_API_KEY` | Basiq application credential (identifies FrodoCodo's own server to Basiq — not a household's bank credential) | Environment variable only (`process.env.BASIQ_API_KEY`, read once in `packages/providers/src/factory.ts`) | N/A — never a DB column, protected by standard platform env-var secrecy (Render) | Until manually rotated in the Basiq dashboard | Manual (dashboard) | Manual (dashboard) | Could create/query Basiq users and connections under FrodoCodo's own Basiq account. **Cannot move money or log into any bank** — Basiq's aggregation product has no payment-initiation capability to escalate into (§6 below), and CDR's own structural separation of read/payment-initiation capabilities (see `docs/banking-data-minimisation-audit.md` §8) means even a compromised aggregator-level credential doesn't cross into banking control. |
| Basiq server-level access token (`scope=SERVER_ACCESS`) | Short-lived bearer token, exchanged from `BASIQ_API_KEY` | **In-memory only**, per process (`BasiqHttpClient`'s private `cachedToken` field) | N/A — deliberately never persisted at all, which is a stronger property than encrypting it (`docs/banking-data-minimisation-audit.md`'s "data never retained cannot later leak" principle, applied here specifically) | Basiq-reported `expires_in` (seconds) — this adapter models it as ~3600s (`expires_in: 3600`, i.e. 60 minutes) per Basiq's documented convention for server tokens; **exact value must still be read from the live `/token` response, never hardcoded as a lifetime assumption** — the code always uses the server-reported `expires_in`, this figure is only the test fixture/expected default | Automatic — `BasiqHttpClient` re-exchanges the API key once the cached token is within 5 seconds of its reported expiry | N/A (nothing to revoke; simply stops being cached/used) | Same blast radius as the API key while valid, for a much shorter window; cheap to let expire naturally since it's re-derived from the API key on demand, never independently long-lived. |
| Basiq user-bound client token (`scope=CLIENT_ACCESS`) | Restricted, user-bound bearer token, exchanged from `BASIQ_API_KEY` + a specific `basiqUserId` — used ONLY to build a Consent UI URL | **Never stored anywhere** — not cached in memory beyond the single call site that immediately builds a Consent UI URL from it, not written to any variable that outlives that call, never persisted | N/A — never retained | Basiq-reported `expires_in`, expected short (the token only needs to survive the one redirect) | Not refreshed — a stale one is simply discarded and a fresh one requested next time a Consent UI URL is needed | N/A (nothing to revoke; simply stops being used) | Could launch the Consent UI for one specific Basiq user — cannot call any management endpoint (accounts, transactions, connections) with it; Basiq's own documented restriction on this token type. |
| A per-connection provider access/refresh token, **if** a real Basiq flow ever requires FrodoCodo to hold one | Provider-specific — Basiq's own architecture may keep bank-level session state entirely on Basiq's side, in which case this is never populated at all | `FinancialConnection.accessTokenEncrypted`/`refreshTokenEncrypted` (nullable `Json` columns, added this task) | **Yes** — AES-256-GCM envelope via `packages/db/src/payloadEncryption.ts` (renamed from `TRANSACTION_PAYLOAD_ENCRYPTION_KEY` to `APP_ENCRYPTION_KEY` this task, since it now protects more than transaction payloads), written/read only through `packages/db/src/connectionTokenStorage.ts` — no other code path may touch these columns directly | Whatever the provider reports, stored in `FinancialConnection.tokenExpiresAt` | Caller-driven (a future sync job would re-authenticate and call `storeConnectionTokens` again on refresh) — no refresh logic exists yet since nothing populates this today | `clearConnectionTokens` — called unconditionally by the disconnect action regardless of whether the provider-side revoke call succeeds (see below) | **Structurally cannot enable internet-banking login, payment initiation, or account modification** — see `docs/banking-data-minimisation-audit.md` §8's credential threat model, which this design implements exactly: a CDR-scoped token is read-only by protocol construction, not by this app's own promise. |
| A household's real bank/Basiq login credential | — | **Nowhere. Must never exist in FrodoCodo at all.** | N/A | N/A | N/A | N/A | This row exists only to state that it must stay empty — if any future change ever causes FrodoCodo's own code to see this value, that is an immediate stop-ship defect, not something to merely mitigate (unchanged from `docs/banking-data-minimisation-audit.md`). |

**Production fail-closed behavior** (already implemented, exercised by
`packages/db/src/__tests__/connectionTokenStorage.test.ts` and
`packages/db/src/__tests__/payloadEncryption.test.ts`): if
`APP_ENCRYPTION_KEY` is missing, `encryptForStorage` throws in production
rather than ever writing a token as plaintext; outside production it
returns `undefined` (the column is simply left null). `decryptFromStorage`
always throws — in every environment — on a missing key, a malformed
envelope, or a tampered/wrong-key ciphertext; a sync job encountering this
must treat it as a hard authentication failure, never fall back to a
cached or partial value.

**Logging**: no line in `packages/providers/src/basiq/` or
`packages/db/src/connectionTokenStorage.ts` ever logs a token, the API
key, or a full URL with query parameters (`BasiqHttpClient`'s error
messages strip query strings via `redactPath`) — proven by
`basiqProvider.test.ts`'s "never logs the API key, server token, or a raw
transaction payload" test, which spies on `console.log`/`console.error`
during a full mock sync and asserts neither secret string appears in any
logged call.

---

## Read-only enforcement (Task 7A item 6)

`BasiqProvider` has exactly six public methods — the same six
`FinancialDataProvider` declares. No method exists for payments,
transfers, payee creation, account modification, or card operations, and
none ever will: `basiqProvider.test.ts`'s "exposes no method beyond
FinancialDataProvider" test enumerates the class's own prototype method
names and asserts the list is exactly the six interface methods, with a
regex guard on top rejecting any future method name that looks
payment/transfer/payee/card-shaped. This is a real, currently-passing type
+ runtime check, not just a design intention — if a future change ever
adds such a method, this test fails immediately.

---

## Sync behavior: pagination, idempotency, dedupe (Task 7A item 7)

- **Pagination**: Basiq's list endpoints follow a JSON:API-style
  `{ data: [...], links: { next } }` shape (confirmed via Basiq's own
  published documentation summaries). `BasiqHttpClient.getAllPages`
  follows `links.next` until exhausted (capped at 1000 pages as a
  runaway-loop guard), used by `listSupportedInstitutions`,
  `discoverAccounts`, and `syncTransactions`. Tested with a 3-page
  synthetic response in `httpClient.test.ts`.
- **Provider transaction IDs preserved**: `mapBasiqTransaction` carries
  Basiq's `id` straight through as `providerTransactionId` — this is what
  makes the existing dedupe logic (`packages/ledger/src/dedupe.ts`,
  unchanged by this task) able to recognize the same transaction across
  repeated syncs.
- **Pending/posted status preserved**: Basiq's `attributes.status`
  (`"pending"`/`"posted"`, per its documented convention) maps directly to
  FrodoCodo's `TransactionStatus` enum; `postingDate` is only ever set once
  status is `POSTED`. Tested explicitly in `basiqProvider.test.ts`.
- **Idempotent re-sync**: proven by a test that runs `syncTransactions`
  twice against two independent `BasiqProvider` instances fed the exact
  same scripted response, asserting the normalized output (ID, amount,
  status) is identical both times — the precondition the existing
  provider-ID-based dedupe in `syncConnection.ts` relies on. No new
  dedupe logic was added or needed; this task does not touch
  `packages/ledger/src/dedupe.ts`'s matching rules.
- **No fuzzy deduplication was added**, per the task's explicit
  instruction — matching stays exact-ID-based (or the documented
  pending→posted heuristic already in place before this task).
- **`sinceDate`/`accountProviderIds` filtering**: attempted server-side via
  a best-effort Basiq filter query string built from Basiq's documented
  filter field names for this endpoint (`connection.id`,
  `transaction.postDate`) plus `limit=500` (Basiq's documented maximum page
  size) — Task 7A.1 correction: scoping by `connection.id` (rather than no
  connection scoping at all) keeps the request from pulling every
  transaction the Basiq user has ever synced across every institution, not
  just this one. **And always re-applied in-memory** regardless of whether
  the server-side filter syntax turns out correct — this guarantees the
  filtering contract holds even though the exact Basiq filter query
  grammar could not be confirmed from this sandbox. Tested in
  `basiqProvider.test.ts`.
- **Malformed/untrusted response handling (Task 7A.1 item 8)**: Basiq's
  responses are untrusted external input. `isValidBasiqAccount`/
  `isValidBasiqTransaction` in `basiqProvider.ts` check the handful of
  fields this adapter's mapping actually depends on (a non-empty `id`, a
  numeric `amount` string, a non-empty `account`/`transactionDate`/
  `description`) before mapping; an entry that fails validation is
  **skipped**, not mapped into a garbage `ProviderAccount`/
  `ProviderTransaction` (e.g. a `NaN` amount, or an empty ID breaking
  downstream dedupe) and not thrown as a fatal error for the whole sync.
  Tested in `basiqProvider.test.ts` with a malformed account (missing
  `id`) and malformed transactions (non-numeric `amount`, missing
  `account`).

Existing transfer/reversal/refund/pending→posted reconciliation
(`apps/worker/src/syncConnection.ts`'s `reconcileTransferReversalsAndRefunds`)
is untouched by this task and continues to run downstream of whatever
provider produced the normalized transactions — it has no
provider-specific code path.

---

## Disconnect/revocation (Task 7A item 10)

`apps/web/app/(app)/settings/actions.ts`'s `disconnectInstitution` now:

1. Looks up the connection's `providerConnectionId`.
2. Calls `provider.disconnectConnection(providerConnectionId)` via
   `createFinancialProvider()` — for `BasiqProvider`, this calls Basiq's
   connection-delete endpoint (best-effort path, unverified exact
   response shape — see below).
3. **Regardless of whether that call succeeded**, calls
   `clearConnectionTokens` (deletes any stored encrypted access/refresh
   token) and marks the connection `isActive: false, consentStatus: "REVOKED"`
   locally.
4. Records an audit event (`recordAuditEvent`) noting whether the
   provider-side revoke succeeded, without logging the connection's
   provider identifiers or any token value.

**Least-surprising default, deliberately chosen**: a household's decision
to disconnect is honored locally even if the remote revoke call fails —
a network blip must never leave a connection the household explicitly
disconnected looking "still active." A cleared local token can't be
replayed even if the provider-side revoke silently didn't take effect.

**What's preserved vs removed**:
- Provider access/refresh token → **cleared** (encrypted columns set to
  null).
- Provider connection ID → left on the `FinancialConnection` row as
  historical record (not reused; a reconnect would create a new one) —
  unchanged from the pre-existing `disconnectInstitution` behavior.
- Local historical transactions → **preserved**. Disconnecting is not
  deletion; the household can always look back at previously-imported
  spending. A separate, explicit action would be needed to delete data —
  not built, since deleting financial history isn't a side effect of
  disconnecting a feed.
- The `Account` record → **preserved**, for the same reason.

Proven end-to-end (not just unit-tested) by
`apps/web/e2e/disconnect-institution.spec.ts` against the real seeded
database and the real server action, running through `createFinancialProvider()`
→ `MockProvider.disconnectConnection` (the same code path a real
`BasiqProvider` would go through) — asserting the connection becomes
inactive/revoked, both token columns are null, and the account and its
transactions still exist with an unchanged count afterward.

**Unresolved**: the exact Basiq revoke-endpoint response shape/status
code on success could not be confirmed from this sandbox;
`BasiqHttpClient.delete` treats any non-2xx response as a hard failure,
which is the conservative default and doesn't need to change — but
confirm this matches Basiq's real behavior before relying on it in
production.

---

## CBA-specific verification (Task 7A item 8)

| Question | Finding | Confidence |
|---|---|---|
| Institution identifier | **Not hardcoded, by design.** `packages/providers/src/basiq/institutionMatch.ts` resolves CBA by matching `GET /institutions`'s live response against an explicit, human-reviewed approved-name allow-list (`SUPPORTED_INSTITUTIONS.CBA` in `scopes.ts`) — the same conclusion `docs/banking-data-minimisation-audit.md` already reached: Basiq's institution IDs are opaque and this environment could not confirm CBA's exact current value (a Basiq test institution ID, `AU00000`, was found via search, but nothing confirming CBA's real one). **Task 7A.1 correction:** matching is now case-insensitive EXACT equality against the allow-list (not the original substring `.includes()` check, which risked a false-positive match against an unrelated institution whose name happened to contain the target text), and the matcher throws — refusing to guess — if more than one live institution matches the same allow-list, rather than silently picking the first (`.find()`) result. Zero matches returns `null`, which is acceptable pre-live state. Querying live and matching by name is also simply more robust regardless of what could be verified here — aggregator IDs can change; the institution's name does not. | High confidence in the *design decision*; the actual ID remains unconfirmed and must come from a live `GET /institutions` call before real use. |
| CDR data holder status | **CDR data holder today** — confirmed in `docs/banking-data-minimisation-audit.md` (major bank, mandatory CDR participant since the original banking-sector rollout); not re-litigated this task. | High |
| Account type coverage | The target product is CBA's everyday/transaction account. Basiq's account `class.type` field is expected to report something transaction-account-shaped, mapped to FrodoCodo's `TRANSACTION` enum value by `mapAccountType`'s keyword match — **exact Basiq class value for a CBA transaction account is unconfirmed** from this sandbox. | Low-medium on the exact class string; functionally inconsequential either way (see the accountType note below). |
| Institution-specific caveat | None found beyond the general CDR-institution behavior already documented. | — |

## Virgin-specific verification (Task 7A item 9)

| Question | Finding | Confidence |
|---|---|---|
| Institution identifier | Same as CBA — resolved live by matching "Virgin Money" against `GET /institutions`, never hardcoded. | High confidence in the design; ID itself unconfirmed. |
| CDR data holder status | **CDR data holder today**, with the precondition (already documented in `docs/banking-data-minimisation-audit.md`) that the card must be registered in the Virgin Money mobile app before it becomes CDR-shareable — an out-of-band household action, not something this adapter can satisfy in code. | High |
| **Both cardholders' transactions on one Velocity High Flyer feed?** | **Yes, with reasonable confidence.** Virgin Money's own published help content (fetched successfully this task — `gethelp.virginmoney.com`/`virginmoney.com.au`, not blocked) describes an "additional cardholder" as a role on the **same underlying credit card account** as the primary cardholder: the additional cardholder gets their own separate Virgin Money Online login but transacts against the same account, for which the primary cardholder remains solely accountable, and additional-cardholder reward points accrue to the primary account. Since CDR shares data at the account level (not per-card-within-account) and nothing in Virgin Money's own material describes a second, separate account object for an additional cardholder, both cardholders' spend should arrive as transactions on the **single** provider account ID this adapter would discover — matching Task 6A's audit conclusion and requiring no per-cardholder scope or field. | Medium-high — corroborated by Virgin Money's own consumer-facing documentation (two independent pages), but the exact CDR technical behavior (whether Virgin's specific CDR implementation tags a transaction with a card-slot/cardholder reference field FrodoCodo would need to explicitly ignore) was not directly confirmed against Virgin's CDR-specific technical documentation, which this sandbox could not reach. |
| Institution-specific caveat | The mobile-app-registration precondition above; no other caveat found. | — |

---

## Unresolved pre-live items (do not connect a real account until these are checked)

1. **Basiq's exact institution ID for CBA and Virgin Money** — resolved by
   this adapter's design (live name-matching, never hardcoded), but the
   actual IDs returned by a real `GET /institutions` call have never been
   seen from this environment.
2. **Exact Basiq Consent Policy dashboard field names/values** for
   configuring `bank:accounts.basic:read`/`bank:transactions:read` —
   corroborated at the concept level (Task 7A.1 confirmed these are real
   CDR-namespaced scope strings, distinct from the API token scope), not
   at the exact dashboard-configuration wire-format level.
3. **Exact Basiq API endpoint paths and payload shapes** used throughout
   `basiqProvider.ts` (`/users`, `/users/{id}/connections`,
   `/users/{id}/accounts`, `/users/{id}/transactions`, the `/token`
   exchange) — modeled on Basiq's documented conventions, not verified
   character-for-character against the live API reference. This includes
   the exact filter query grammar `/users/{id}/transactions` accepts
   (Task 7A.1 aligned the field names used — `connection.id`,
   `transaction.postDate` — to Basiq's documented filter fields, but the
   precise syntax remains unverified; the in-memory filter is the real
   correctness guarantee regardless).
4. **Server-level token lifetime (`expires_in`)** — this adapter always
   uses whatever value Basiq's `/token` response reports, never a
   hardcoded assumption; Basiq's documented convention is understood to be
   ~60 minutes for both SERVER_ACCESS and CLIENT_ACCESS tokens, but the
   exact live value is unconfirmed from this sandbox.
5. **The hosted Consent-UI redirect flow end-to-end** — Task 7A.1 added
   `consentUi.ts`'s URL builder (`https://consent.basiq.io/home?token=...`)
   as a tested, pure construction function, but it has never been launched
   against a real browser or wired into any route; `initiateConnection`
   still omits `redirectUrl` rather than guessing how a real caller should
   sequence "get CLIENT_ACCESS token → build Consent UI URL → redirect →
   handle the `state`-verified return."
6. **Multi-institution household flow — now supported at the adapter
   level, not yet wired into a real caller.** Task 7A.1 added an optional
   `existingProviderUserId` parameter to `initiateConnection` (skips
   `POST /users` and creates the new connection directly under the
   existing Basiq user) and an exported `getBasiqUserIdFromConnectionId`
   helper so a caller with household/database context (which
   `packages/providers` deliberately never has — see CLAUDE.md) can decode
   an existing active Basiq connection's user ID and pass it through when
   connecting a household's second institution. **No real connect-flow UI
   exists in `apps/web` yet** (only `disconnectInstitution` does) — this
   capability is ready for that future caller, not yet exercised outside
   unit tests.
7. **Basiq's exact account-class taxonomy** for distinguishing
   TRANSACTION from SAVINGS accounts — Basiq is understood to sometimes
   report a combined class for both; `packages/providers/src/basiq/basiqProvider.ts`'s
   `mapAccountType` documents why this ambiguity doesn't affect
   correctness (accountType's only real dependency is the
   credit-card-vs-not distinction).
8. **Basiq's connection-revoke endpoint's exact success response shape.**
9. Everything already flagged unresolved in
   `docs/banking-data-minimisation-audit.md` (Amex's CDR status/cohort,
   exact CDR scope string spelling) remains unresolved and out of this
   task's scope (Amex is explicitly excluded from this adapter).

None of the above were worked around, assumed favorably, or silently
guessed past — each is either resolved by a design choice that doesn't
depend on the unconfirmed detail (name-matching instead of a hardcoded
ID; in-memory-only server token instead of guessing its exact lifetime) or
explicitly listed here as a pre-live confirmation step.

---

## Human Basiq-dashboard setup checklist (Task 7A.1 item 10)

Everything above is code that exists and is tested today. The following
items genuinely require a human with access to a real Basiq
account/dashboard and cannot be completed from this codebase or this
sandbox — they are listed here as an exact checklist so a future session
knows precisely what's left, without being asked to start any of it now:

1. **Register/create the Basiq application** in the Basiq dashboard (or
   confirm an existing one) and obtain its **API key**
   (`BASIQ_API_KEY`) — a server-side secret, never committed, set only as
   a Render environment variable per `docs/security-privacy.md`.
2. **Enable Open Banking/CDR access** for that application, if it is not
   enabled by default on account creation — the specific toggle/plan tier
   this requires is a Basiq account-management detail, not visible from
   this sandbox.
3. **Configure the application's Consent Policy** to request exactly
   `bank:accounts.basic:read` and `bank:transactions:read`
   (`BASIQ_CONSENT_POLICY_SCOPES` in `scopes.ts`) — and confirm none of
   `BASIQ_REFUSED_CONSENT_POLICY_SCOPES` are enabled.
4. **Select/enable CBA and Virgin Money** (and only those two) as
   connectable institutions for the application, if Basiq requires
   explicit per-institution enablement rather than exposing every CDR data
   holder by default.
5. **Configure the Consent UI redirect/return URL(s)** the household's
   browser lands on after completing (or cancelling) consent — this is
   what a real `state`-verified callback route in `apps/web` would need to
   exist at, and doesn't yet.
6. **Confirm production-access / commercial-onboarding requirements** —
   whether Basiq's sandbox/test environment is sufficient for a genuine
   single-household deployment like FrodoCodo's, or whether a commercial
   agreement/accreditation step is required before real CDR consent can be
   requested from a real household.
7. Once 1–6 are done: perform a **live, sandboxed** (never production
   household data on the first pass) call to `GET /institutions` to
   finally confirm CBA's and Virgin Money's real institution IDs, and a
   live `/token` exchange to confirm the actual `expires_in` value for
   both SERVER_ACCESS and CLIENT_ACCESS tokens — closing unresolved items
   1 and 4 above.

Nothing in this checklist was started, simulated, or worked around in this
task — it is presented as the precise boundary between "code-completable"
and "requires the real Basiq dashboard," per Task 7A.1's explicit
instruction not to ask the user to perform these yet.
