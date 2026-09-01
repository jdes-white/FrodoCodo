# Basiq provider adapter (Task 7A)

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

---

## Architecture

```
packages/providers/src/basiq/
  scopes.ts            -- the exact data-cluster/scope boundary (§2)
  types.ts              -- Basiq response shapes this adapter reads
  httpClient.ts          -- auth (SERVER_ACCESS token, cached in-memory) + pagination
  institutionMatch.ts    -- resolves CBA/Virgin by NAME against the live institutions list
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

## Consent/data scope boundary (Task 7A item 2)

Basiq's own consent model — confirmed via its published documentation
summaries — is a **consent policy** configured against the Basiq
application in its dashboard, not a set of raw OAuth scope strings this
adapter constructs per request. A consent policy is presented to the
household when they connect an institution and names which data clusters
it covers; Basiq's own material distinguishes households who "share only
accounts" from those who "consented to share both accounts and
transactions," confirming `accounts` and `transactions` are real, named,
independently-grantable clusters in Basiq's model — not this project's own
invention.

`packages/providers/src/basiq/scopes.ts` declares exactly this boundary as
constants:

```ts
export const BASIQ_REQUESTED_DATA_CLUSTERS = ["accounts", "transactions"] as const;

export const BASIQ_REFUSED_DATA_CLUSTERS = [
  "account_details",   // full/unmasked account number, BSB, detailed product terms
  "identity",           // customer name, address, contact details, DOB
  "payees",             // third-party payee names + BSB/account numbers
  "regular_payments",   // scheduled payments / direct-debit authority metadata
  "cards",               // card number/expiry/CVV-adjacent metadata
  "payments",           // payment initiation / money movement
] as const;
```

`packages/providers/src/basiq/__tests__/scopes.test.ts` asserts the
requested set is exactly `["accounts", "transactions"]`, that none of the
refused clusters appear in it, and that every category the task named
(unmasked account numbers/BSBs, customer identity, payees, scheduled
payments, card details, payment initiation) is explicitly enumerated as
refused rather than merely "not mentioned."

Server-to-server calls authenticate with Basiq's `scope=SERVER_ACCESS`
token type (Basiq's own full-server-access token, confirmed via its
published docs — distinct from the narrower, browser-facing
`CLIENT_ACCESS` token type, which this adapter never requests or holds).
This is a fixed constant (`BASIQ_SERVER_TOKEN_SCOPE`), not a literal
scattered through the codebase.

**Unresolved (do not treat as confirmed):** the exact JSON field name(s)
Basiq's consent-policy API uses for these cluster names, and whether
"accounts" implicitly includes balance data or is itself sub-divided
further. Confirm against `api.basiq.io/docs/consent` (blocked from this
sandbox) before configuring a real consent policy.

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
| Basiq server-level access token (`scope=SERVER_ACCESS`) | Short-lived bearer token, exchanged from `BASIQ_API_KEY` | **In-memory only**, per process (`BasiqHttpClient`'s private `cachedToken` field) | N/A — deliberately never persisted at all, which is a stronger property than encrypting it (`docs/banking-data-minimisation-audit.md`'s "data never retained cannot later leak" principle, applied here specifically) | Basiq-reported `expires_in` (seconds) — **exact typical value unconfirmed from this sandbox**; treat as short (order of tens of minutes to an hour) until verified | Automatic — `BasiqHttpClient` re-exchanges the API key once the cached token is within 5 seconds of its reported expiry | N/A (nothing to revoke; simply stops being cached/used) | Same blast radius as the API key while valid, for a much shorter window; cheap to let expire naturally since it's re-derived from the API key on demand, never independently long-lived. |
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
  a best-effort (unverified) Basiq filter query string, **and always
  re-applied in-memory** regardless of whether the server-side filter
  syntax turns out correct — this guarantees the filtering contract holds
  even though the exact Basiq filter query grammar could not be confirmed
  from this sandbox. Tested in `basiqProvider.test.ts`.

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
| Institution identifier | **Not hardcoded, by design.** `packages/providers/src/basiq/institutionMatch.ts` resolves CBA by matching `GET /institutions`'s live response against the name "Commonwealth Bank" — the same conclusion `docs/banking-data-minimisation-audit.md` already reached: Basiq's institution IDs are opaque and this environment could not confirm CBA's exact current value (a Basiq test institution ID, `AU00000`, was found via search, but nothing confirming CBA's real one). Querying live and matching by name is also simply more robust regardless of what could be verified here — aggregator IDs can change; the institution's name does not. | High confidence in the *design decision*; the actual ID remains unconfirmed and must come from a live `GET /institutions` call before real use. |
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
2. **Exact Basiq consent-policy JSON field names/values** for the
   `accounts`/`transactions` data clusters — corroborated at the concept
   level, not at the wire-format level.
3. **Exact Basiq API endpoint paths and payload shapes** used throughout
   `basiqProvider.ts` (`/users`, `/users/{id}/connections`,
   `/users/{id}/accounts`, `/users/{id}/transactions`, the `/token`
   exchange) — modeled on Basiq's documented conventions, not verified
   character-for-character against the live API reference.
4. **Server-level token lifetime (`expires_in`)** — assumed short-lived;
   exact typical value unconfirmed.
5. **The hosted Consent-UI redirect URL** `initiateConnection` would need
   to return — deliberately left unimplemented (`redirectUrl` omitted)
   rather than guessed.
6. **Multi-institution household flow**: `initiateConnection` always
   creates a fresh Basiq user. A household connecting a *second*
   institution (e.g. Virgin after already connecting CBA) should reuse the
   first connection's Basiq user rather than create a second one — this
   requires a connection-initiation flow with household context that
   doesn't exist yet (packages/providers must stay database-free, so this
   can't be resolved inside the adapter itself). Not built this task.
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
