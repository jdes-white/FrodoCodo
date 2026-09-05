# Banking data-minimisation & threat-model audit (Task 6A)

**Status: READ-ONLY AUDIT. No schema change, no integration code, no live
bank connection, no Basiq user, no real CDR consent was created to produce
this document.** This is the pre-implementation security/privacy gate for
connecting real accounts. See `docs/provider-integration.md` for the
existing (August 2026) provider-coverage note this audit supersedes with
deeper detail, and `docs/security-privacy.md` / `CLAUDE.md` rule 3/9/10 for
the standing principles this audit applies.

**Research caveat, stated up front:** this sandbox's network egress proxy
blocks direct fetches to `cdr.gov.au`, `basiq.io`, `accc.gov.au`,
`consumerdatastandardsaustralia.github.io`, `virginmoney.com.au`, and
several other primary sources cited below. Every claim in this document
that would normally cite a primary source was instead corroborated through
multiple independent secondary sources (search-indexed summaries of those
same pages, industry commentary, aggregator documentation excerpts) rather
than a direct read of the authoritative page. This is **explicitly flagged
per finding** below, and section 9 ("unresolved risks") repeats it as a
standing item: **before writing any integration code, re-verify the exact
scope strings, Amex's CDR designation cohort/date, and Basiq's Amex
connection method against the live CDR Register (`cdr.gov.au/find-a-provider`)
and Basiq's own API docs (`api.basiq.io/docs`) from an unrestricted network.**

---

## 1. Provider coverage verdict — CBA / Virgin / Amex

| Product | Institution | CDR status (as researched) | Confidence |
|---|---|---|---|
| CBA debit/offset transaction account | Commonwealth Bank of Australia | **CDR data holder today.** CBA is one of the four major banks and has been a mandatory CDR data holder for transaction/savings accounts since the original 2020 banking-sector rollout. Offset accounts are a sub-type of transaction/savings account for CDR product-category purposes, not a separate designated dataset. | High for "CBA shares transaction accounts via CDR" (multiply-corroborated, long-standing, non-controversial fact). **Medium** specifically for "the offset sub-product is exposed with identical fidelity to a plain transaction account" — this is a reasonable inference, not something I could confirm against CBA's own CDR product-reference API from this sandbox. Verify by pulling CBA's live CDR Product Reference API (or Basiq's mirrored institution/account-type metadata) for the specific offset product before connecting. |
| Virgin Australia Velocity High Flyer credit card | Virgin Money Australia | **CDR data holder today**, confirmed via Virgin Money's own "Open Banking" support page content (indexed, not directly fetched — see caveat above) describing identity verification before data sharing. Consistent with the prior finding in `docs/provider-integration.md`: **the card must be registered in the Virgin Money mobile app before it becomes shareable via CDR** — an out-of-band precondition, not something FrodoCodo's code can satisfy. | Medium-high. Re-verify directly against Virgin Money's Open Banking page and Basiq's institution list once network access allows, and confirm the app-registration precondition still holds. |
| American Express Velocity Platinum | American Express Australia | **Not a CDR data holder today.** Amex AU is a non-ADI (non-bank) credit/charge-card issuer. The CDR's non-bank-lenders-sector expansion has product-reference-data obligations starting **13 July 2026** and consumer-data-sharing obligations starting **9 November 2026 for "initial providers"** (a later date, 10 May 2027, applies to "large providers"). I could not confirm from this sandbox which cohort (if any) Amex AU falls into, or find Amex AU explicitly named on the CDR Register as a designated data holder. Treat Amex as **CDR-unavailable until independently confirmed otherwise.** | **Low-medium on timing/cohort specifically** — this is the single most important fact to re-verify before scoping any Amex work, since it changes the entire consent/credential model for that one product. |

**Practical consequence:** Amex must go through Basiq's (or an equivalent
aggregator's) **non-CDR "Connect" pathway** — a credential-based
("screen-scraping"-style) connection, not an OAuth/CDR consent. Every
finding in sections 2–8 below treats CBA and Virgin as CDR flows and Amex
as a **separate, materially different, higher-trust-dependency pathway**
until Amex joins CDR for real (at which point it becomes a config change,
not a rewrite — this was already the design intent in
`docs/provider-integration.md` and remains correct).

**Aggregator choice:** Basiq remains the right choice — ACCC-accredited
Data Recipient, ~136 AU/NZ institutions, and (per its own documentation,
indexed but not directly fetched) offers both CDR and non-CDR "Connect"
pathways from one API, so Amex's eventual CDR migration is a Basiq-side
reclassification rather than an integration rewrite on FrodoCodo's side.
No evidence was found that a different aggregator would materially change
this picture for these three specific products; a full RFP-style
alternative-aggregator comparison was not performed since Basiq already
satisfies all three products and re-litigating the choice isn't warranted
by anything found in this audit.

---

## 2. Consent/data scopes

### 2a. What FrodoCodo actually needs (CDR pathway — CBA, Virgin)

To discover, identify-across-syncs, and pull posted + pending transactions
for exactly one nominated account per connection, FrodoCodo needs only the
CDR **banking** scopes that grant:

- **Account list/basic detail** — enough to enumerate the household's
  accounts at that institution and let them pick which one(s) to connect
  (this is the "discover/select" requirement). This is the
  `bank:accounts.basic:read`-class scope (exact string to be confirmed
  against the live Consumer Data Standards register — see caveat).
- **Transactions, posted and pending** — the `bank:transactions:read`-class
  scope. CDR's transaction dataset includes both posted and pending
  transactions where the data holder itself tracks pending state (most
  major-bank CDR implementations do); no separate scope exists for
  "pending only," so this single scope covers both cases in section 1's
  requirement.
- **Minimal OIDC plumbing** (`openid`, and whatever minimal profile scope
  the CDR consent flow itself requires to complete the OAuth handshake) —
  this is protocol overhead, not a data grant FrodoCodo acts on.

That's it. Two data-bearing scopes cover every capability in the "required"
list from the task (discover, identify reliably, pull posted, pull
pending).

### 2b. Scopes FrodoCodo will explicitly refuse to request

| Scope class | What it exposes | Refuse? |
|---|---|---|
| `bank:accounts.detail:read`-class (account detail) | Full/unmasked account number, BSB, detailed product terms, interest rate | **Refuse.** FrodoCodo never needs the real account number — an opaque provider account ID is sufficient to identify the account across syncs (see §5). |
| `common:customer.basic:read`-class | Legal name on the account | **Refuse.** The household already knows their own name; FrodoCodo has its own login/user identity model (`User`/`Household` in Prisma) entirely independent of the bank's name-on-account. |
| `common:customer.detail:read`-class | Address, phone, email, occupation, DOB | **Refuse.** None of this feeds any budgeting calculation. |
| `bank:payees:read`-class | Saved payee list (names + BSB/account numbers of people the household pays) | **Refuse.** This is third-party PII (other people's bank details) FrodoCodo has no legitimate use for and would be a serious breach liability to hold. |
| `bank:regular_payments:read`-class | Scheduled payments / direct-debit authority metadata | **Refuse.** `UpcomingCommitment` already exists as a *household-entered* forecast model (see `packages/db/prisma/schema.prisma`) specifically so this doesn't need to come from the bank. Direct-debit *authority* data (who's allowed to pull money) is a payment-initiation-adjacent capability FrodoCodo has no reason to see. |
| Any card-number / card-detail scope | PAN, expiry, CVV-adjacent metadata | **Refuse.** Never needed — transactions arrive with amounts/descriptions, not the instrument's card number. |
| Any payment-initiation / disbursement scope (CDR's action-initiation extensions where live) | Ability to move money, add payees, initiate payments | **Refuse absolutely.** This is the hard line from item 8 of the task — FrodoCodo is read-only by design and must never request a write/initiation scope even if a future CDR extension makes one available for banking. |

**Net effect:** of the full CDR banking scope surface, FrodoCodo requests
**2 of roughly 7–8 scope classes**, and structurally cannot be granted
payment/write capability even if a household clicked "allow everything" in
the consent screen, because FrodoCodo's Basiq client registration would
simply never request those scopes in the first place — CDR consent is
opt-in per requested scope, not all-or-nothing, so under-requesting is a
client-side design choice FrodoCodo fully controls.

### 2c. Amex non-CDR "Connect" pathway — a structurally different model

Because Amex isn't CDR-accessible yet, "scopes" don't apply in the same
sense — Basiq's non-CDR Connect flow is closer to a scoped, hosted
credential-relay: the household enters their Amex online-banking
credentials into **Basiq's own hosted widget** (indexed Basiq
documentation describes this as a DOM-embeddable "Connect" control that
is itself served from Basiq's domain, not FrodoCodo's), and Basiq's
backend then retrieves account/transaction data on Amex's own online
banking site on the household's behalf. Two consequences:

1. **FrodoCodo's own client/server code should never see, log, request, or
   have the ability to capture the Amex credential** — the same hosted-
   widget pattern CDR's OAuth redirect uses. This must be verified against
   Basiq's actual Connect-widget contract before implementation (see
   §10) — if Basiq's Connect flow for some institution ever required the
   *client application* to collect and forward credentials itself (rather
   than hosting its own credential-entry surface), that would be a
   materially worse threat model and a reason to reconsider Amex support
   entirely rather than build around it.
2. Because this is credential-based access rather than a scoped OAuth
   grant, there is no scope enumeration to under-request from — the
   practical mitigation is entirely architectural (never let the
   credential transit FrodoCodo) and contractual (confirm Basiq's own
   retention/scope-limiting behavior on the Amex side), not a consent
   checkbox FrodoCodo controls.

---

## 3. Field-level data contract

Classifications per the task's four buckets, evaluated field-by-field
against what CDR/Basiq responses plausibly contain for the required flow.

### Account discovery/sync response

| Field | Classification | Rationale |
|---|---|---|
| Opaque provider account ID | **REQUIRED + STORE** | Only thing needed to identify the account across syncs. Already the model — `Account.providerAccountId`. |
| Account type (transaction/credit card/savings) | **REQUIRED + STORE** | Drives `AccountType` enum, needed for transfer-pair detection (§7) and UI grouping. |
| Provider/institution name | **REQUIRED + STORE**, but only as the aggregator/institution key (`FinancialInstitution.providerInstitutionId`/`providerName`), never surfaced raw to the UI — see §5 for the alias layer. |
| Household-chosen or provider display name/nickname | **REQUIRED TEMPORARILY + DISCARD BEFORE PERSISTENCE (in its raw form)** | Today `Account.displayName` stores whatever the provider sends verbatim, which for a real CDR response is typically a product name plus a masked-last-4 fragment (e.g. "Complete Access ...1234"). That's more than the task's "simple source alias" requirement. **Concrete change needed at implementation time**: derive the stored `displayName` from FrodoCodo's own alias mapping (§5), not the provider's string, and discard the provider's original nickname/product-name string after account discovery rather than persisting it. |
| Current/available balance | ~~**REQUIRED + STORE**~~ **OPTIONAL + DO NOT REQUEST/PERSIST** — corrected by Task 6C | This audit originally reasoned balance was core to "how much do we have left." On the Task 6C hardening pass that assumption was checked against the actual codebase and found wrong: FrodoCodo's "how much is left" is *budget remaining* (allocation minus spend, `apps/web/lib/budgetSnapshot.ts`), which never reads an account balance, and nothing else in the product does either. Removed from the persisted `Account` model and the account ingestion allow-list (`packages/ledger/src/ingestion.ts`) rather than kept on the original (incorrect) assumption. |
| Full/unmasked account number | **PROVIDER MAY SEND ANYWAY + DISCARD** under the CDR pathway (not requested — see §2b — but some `accounts.basic`-class responses embed a masked number by convention; confirm it's masked, not full, before treating this as safe to even transiently hold) | Never persisted under any circumstance. |
| BSB | **OPTIONAL + DO NOT REQUEST** | Never needed; excluded at the scope level (§2b) so it should never arrive at all under CDR. Under Amex's non-CDR pathway, confirm Basiq's response shape doesn't surface it either. |
| Interest rate / product T&Cs / fee schedule | **OPTIONAL + DO NOT REQUEST** | Irrelevant to budgeting; part of the `accounts.detail` scope FrodoCodo refuses. |
| Card number/PAN | **OPTIONAL + DO NOT REQUEST** | Never needed; never in scope. |

### Transaction sync response

| Field | Classification | Rationale |
|---|---|---|
| Provider transaction ID | **REQUIRED + STORE** (nullable — some pending transactions arrive with none, already modeled) | Primary dedupe key alongside account + date + amount. |
| Transaction/posting date | **REQUIRED + STORE** | Core to pacing/budget-period math. |
| Amount | **REQUIRED + STORE** | Core to everything. |
| Direction (debit/credit) | **REQUIRED + STORE** | Needed for transfer detection (§7) and spend vs. income. |
| Pending/posted status | **REQUIRED + STORE** | Needed to avoid double-counting a transaction that later re-arrives as posted with a new provider ID (§7). |
| Merchant/description text | **REQUIRED + STORE, but normalised — see §6** | The whole product depends on this; §6 covers exactly what "store" means here. |
| Provider-enriched merchant/category (Basiq's own MCC-based enrichment, where offered) | **REQUIRED TEMPORARILY + DISCARD BEFORE PERSISTENCE of the raw enrichment payload, but the *derived* enriched merchant/category string is REQUIRED + STORE** | This is Layer 3 of `classifyDeterministic` (CLAUDE.md rule 5) — FrodoCodo needs the enrichment *result* (a clean merchant name/category), not the enrichment provider's internal metadata bundle around it. |
| Full raw provider payload (the entire JSON object Basiq returns for the transaction) | **See §4 — separate policy, not a blanket "store."** | |
| Any embedded payee/counterparty account number or BSB inside a transaction reference (e.g. a PayID or BPAY biller reference sometimes embeds this) | **PROVIDER MAY SEND ANYWAY + DISCARD** | Never intentionally requested, but free-text transaction references can contain this incidentally (§6 covers redaction approach). |
| Location/geo metadata (some enrichment providers attach merchant lat/long) | **OPTIONAL + DO NOT REQUEST** | Not used by any FrodoCodo feature; discard if present. |

### Consent/connection metadata

| Field | Classification | Rationale |
|---|---|---|
| Consent status, granted/expiry timestamps | **REQUIRED + STORE** | Already modeled (`FinancialConnection.consentStatus/consentGrantedAt/consentExpiresAt`) — needed to show the household their connection is healthy and to know when re-consent is needed. |
| The CDR consent/access token itself, or the Amex credential-derived session token | **REQUIRED TEMPORARILY, ENCRYPTED, NEVER IN PLAINTEXT AT REST — see §8**, not a "discard before persistence" case since it must persist to make future syncs possible, but it is the single most sensitive thing FrodoCodo holds and is scoped accordingly. | |
| Amex (or any non-CDR) raw login credential | **NEVER + FRODOCODO SHOULD NEVER RECEIVE THIS AT ALL** | Per §2c, this must stay inside Basiq's hosted widget. If at implementation time it turns out any adapter code path would receive this value even transiently (e.g., a webhook payload that echoes it back for some institutions), that is a stop-ship finding, not a "discard it" instruction — the fix is to change the integration pattern, not to add a discard step after the fact. |

**Bottom line for §3 of the task:** full account number, BSB, legal name,
address, contact details, card numbers, and detailed account
metadata can all be kept out of FrodoCodo entirely — none of them are in
the scope set requested (§2b), and the few fields that could arrive
incidentally despite not being requested (a masked-number fragment in a
nickname string, a BSB fragment in a free-text reference) are handled by
discarding/normalising at ingestion, not by storing-then-redacting.

---

## 4. Raw provider payload policy

**Recommendation: stop persisting the raw provider payload once live data
exists. Extract the minimum normalized fields, encrypt only what must
briefly exist for sync reliability, and do not keep an encrypted copy of
the original banking payload as a standing column.**

This is a reversal of the current mock-data-era design
(`Transaction.rawProviderPayload`, encrypted per security-audit finding
H3) once real accounts are connected, for a reason H3's own fix already
flagged: encryption reduces exposure *if the database is exfiltrated*, but
it doesn't reduce what exists to exfiltrate. `docs/security-privacy.md`
already calls this column "the highest-sensitivity data in the schema" for
a real deployment — the stronger fix available now that live-account
scoping is being designed properly is to **make that data not exist
in FrodoCodo at all**, rather than defend it with encryption alone
(defense in depth is good; not creating the exposure is better, and this
audit's whole mandate is minimisation over mitigation).

**What "raw payload" actually contains that we don't need**: for a CDR
transaction response this typically includes the full transaction record
as the bank's own CDR API shapes it — which can include fields like
merchant location, the reporting bank's internal category code, biller
codes, and in some data holders' implementations, name/reference fields
that weren't scoped out at the account level but appear inline in a
transaction's free-text fields. None of this is used by any FrodoCodo
feature once the normalized `Transaction` row exists.

**Narrow exception — a bounded debug/reliability window, not a standing
column:**

If sync reliability work genuinely needs to inspect what a provider sent
for a specific failed/mismatched sync (e.g., diagnosing why a dedupe
matched or didn't), propose:

- **Not a database column at all.** Write the raw payload to a
  short-lived, encrypted, worker-local artifact (or a separate, tightly
  access-controlled object store bucket) — never a queryable Postgres
  column that every backup, every `SELECT *`, and every future feature
  built against the `Transaction` table can casually reach.
- **Retention: 7 days, hard-deleted by a scheduled job**, not soft-deleted
  — long enough to debug a sync failure noticed within a week (matching
  Neon's own PITR-adjacent reasoning already used elsewhere in this repo
  for backup retention), short enough that it's never a standing liability.
- **Scoped to failed/anomalous syncs only** — a normal successful sync
  (the overwhelming majority) never needs its raw payload retained even
  temporarily; only capture it when `SyncRun.status` indicates an error or
  when dedupe/verification logic flags a mismatch worth investigating.
- **Access-controlled separately from the application's normal database
  credentials** — the point of taking this out of the `Transaction` table
  is defeated if it's just as reachable as everything else from the same
  compromised credential.

**If this narrow exception is never actually needed in practice** (i.e.,
sync bugs turn out to be diagnosable from the normalized fields plus
structured logs), don't build it preemptively — CLAUDE.md's own
engineering principles argue against building for a hypothetical; only add
this mechanism when a real sync-debugging need demonstrates it.

---

## 5. Source aliases and UI

**Design: `opaque provider account ID → FrodoCodo-owned alias`, exactly as
the task specifies, and yes — FrodoCodo can operate without ever
persisting or displaying the real account number.**

Concretely:

- `Account.providerAccountId` (already exists) is the only banking-side
  identifier FrodoCodo keeps — it's opaque (an aggregator-issued ID, not a
  bank-format account number) and stable enough to dedupe across syncs.
- Add a household-facing alias that is **entered/confirmed by the
  household at connection time**, not derived from whatever string the
  provider's `displayName`/nickname field contains (closing the gap
  identified in §3's account-fields table). Sensible defaults to *suggest*
  (never silently persist unconfirmed) based on institution + account
  type — e.g. "CBA", "Virgin", "Amex" per the task's own examples — with
  the household able to rename to whatever's meaningful to them (e.g. two
  cardholders might want "Amex (Alex)" / "Amex (Sam)" as aliases for what
  are, at the provider level, one shared account with two cardholders —
  see the two-cardholder note below).
- The detailed-transaction-scrutiny view shows only this alias — never the
  institution's own product name, never any masked-number fragment.
- Two-cardholder accounts (Virgin Velocity High Flyer, Amex Velocity
  Platinum both explicitly include "both cardholders" per the task):
  under CDR/Basiq, both cardholders' transactions arrive under **one
  provider account ID** (a joint/companion-card account is one account
  from the bank's perspective) — FrodoCodo doesn't need, and shouldn't
  request, any scope that would identify *which* cardholder made a given
  transaction, since that's cardholder-identifying metadata adjacent to
  the customer-detail scopes already refused in §2b. If per-cardholder
  attribution is ever wanted, that has to be a household-side classifier
  (e.g. matching merchant patterns to "who usually shops here"), never a
  provider-supplied field.

**This fully satisfies the task's §5 confirmation question**: no full
account number needs to ever exist in FrodoCodo's database, logs, UI, or
raw payload retention window, under either the CDR or Amex non-CDR path,
given the scope refusals in §2b and the discard-at-ingestion rule for the
provider's own nickname string in §3.

---

## 6. Transaction privacy (descriptions)

Treat the raw provider `description` as the sensitive field it is
(correctly identified in the task — it can contain a payee's name, a
PayID message, a BPAY reference, or a merchant's suburb/location string),
while preserving categorisation quality:

- **Store a normalised description, not the verbatim provider string, as
  the primary field the UI and classifier operate on.** Today
  `Transaction.originalDescription` stores the provider string verbatim.
  Recommend splitting this into:
  - `displayDescription` (or reuse `originalDescription`'s name but change
    its content contract): the provider string run through the *existing*
    merchant-normalisation pipeline (`packages/ledger`'s classification
    layer already normalises merchant strings for matching — extend that
    same pass to also strip free-text tails past the merchant token, e.g.
    "COLES 1234 SYDNEY AU CARD 4521" → "Coles", not the full string) —
    this is what's shown in the UI and what the task's example output
    ("Coles — $250.60 → Groceries") already implies.
  - A verbatim copy is **not** kept as a separate stored field once the
    normalised version exists — this is the same "don't retain a field
    merely because the provider supplies it" instruction from §3 of the
    task, applied to descriptions specifically. If normalisation is ever
    wrong in a way that harms categorisation, the fix is improving the
    normaliser (already the pattern in `packages/ledger/src/classification.ts`
    per CLAUDE.md rule 6 — user corrections make the system smarter), not
    falling back to storing the raw string "just in case."
- **Categorisation reliability is not compromised by this**: the
  classifier's precedence chain (household rule → learned mapping →
  provider enrichment → AI suggestion → review queue, CLAUDE.md rule 5)
  already operates on a normalised merchant key, not the raw description —
  it was never depending on payee names or PayID free text to classify
  correctly in the first place, so removing that incidental PII doesn't
  remove any classification signal that mattered.
  Genuinely ambiguous free-text-heavy transactions (e.g., a manual bank
  transfer with a payee's name as the only "merchant" signal, like a
  cleaner paid by direct transfer — the task's own "Cleaner — $150.00"
  example) will still fall through to the review queue exactly as
  low-signal transactions do today; a household confirming "this is my
  cleaner" and creating a `MerchantRule` handles this correctly without
  ever needing FrodoCodo to retain the raw payee-identifying string
  permanently — the *rule* (merchant key → category) persists, not the
  original free-text description that triggered it.
- **Notes field stays user-authored only** (`Transaction.notes` — already
  the case) — never auto-populated from provider free text.

---

## 7. Transfers and double-counting

The existing `packages/ledger/src/transferDetection.ts` (amount + 3-day
window + cross-account matching) already handles the core case correctly
and should not need conceptual changes for real data — but real bank
timing behavior introduces edge cases worth stating explicitly before
live data arrives:

| Scenario | Deterministic handling |
|---|---|
| CBA → Amex card repayment | Debit leg (CBA) + credit leg (Amex account) matched by amount + date window → `CREDIT_CARD_REPAYMENT`, both legs `isTransfer + isExcludedFromBudget` (existing logic, CLAUDE.md rule 4). |
| CBA → Virgin card repayment | Same pattern, same handling — no institution-specific logic needed since matching is amount/date/cross-account, not provider-aware. |
| Inter-account transfers (e.g. CBA main → a savings account, if ever connected) | `INTER_ACCOUNT_TRANSFER` kind, same exclusion. |
| Refunds | Already modeled separately (`Transaction.refundOfTransactionId`/`refunds` relation) — a refund is not a transfer-pair match (same account, not cross-account) and must **not** be excluded from budget the same way; it should net against the original spend in the category total, which is the existing refund-chain design, not something this audit needs to change. |
| Reversed card transactions | A bank-initiated reversal (distinct from a merchant refund) typically arrives as a new transaction with an equal-and-opposite amount on the *same* account, same/adjacent date, often with a provider transaction ID that differs from the original. **Recommend**: extend transfer/refund detection with a same-account, equal-and-opposite, tight-window (e.g. 1–2 days) match that nets the pair to zero net spend — distinct from `TransferMatch` (which requires cross-account) and from `refundOf` (which is typically merchant-initiated, days-to-weeks later, and a separate `Category`-relevant chain). This is a genuine gap relative to the current model and should be designed (not necessarily built) before live data exposes it — flagged here as a concrete pre-implementation task, not merely a risk. |
| Pending → posted transitions | Handled today via `TransactionStatus` + the nullable `providerTransactionId` dedupe tolerance already noted in `packages/providers/src/types.ts`'s doc comment (§10). **Concrete rule to confirm at implementation**: when a posted transaction arrives that matches a pending one on account + amount + date (± the posting lag) but with a *different* provider transaction ID, the sync must update the existing row in place (carrying over any user classification/override) rather than inserting a second row — otherwise the same real-world transaction is double-counted as spend. This needs a dedicated dedupe rule beyond straight `providerTransactionId` equality since Basiq/CDR data holders don't universally guarantee ID stability across the pending→posted transition. |
| Duplicate provider records (a sync re-delivers a transaction Basiq already sent, e.g. after a retry) | The existing `@@unique([accountId, providerTransactionId])` DB constraint already prevents a literal duplicate insert when the ID is stable; the pending→posted case above is the harder variant where the ID *isn't* stable and needs the amount/date/account heuristic instead. |
| Investment/savings transfers | Out of scope for the three named products (none of CBA offset / Virgin credit / Amex credit is an investment account), but if a savings account is ever added later, it falls under the existing `INTER_ACCOUNT_TRANSFER` path — no new category needed. |

**Net assessment**: the existing transfer/refund model is sound and
mostly sufficient; the one real gap worth closing *before* connecting live
accounts is explicit reversed-transaction handling (row above) — everything
else is either already correctly modeled or is a dedupe-robustness
refinement to the existing pending→posted logic rather than a new concept.

---

## 8. Credential/token threat model

Every credential/token FrodoCodo would hold after connecting a bank, and
what possessing it actually enables:

| Credential/token | Where stored | Encrypted at rest? | Lifetime | Rotation/revocation | What an attacker holding it could do |
|---|---|---|---|---|---|
| Basiq API key (server-side, identifies FrodoCodo's *application* to Basiq — not the household's bank credential) | Environment variable (`BASIQ_API_KEY`), per `docs/provider-integration.md`/`docs/security-privacy.md` — never in the DB, never client-exposed | N/A (env var, not a DB column); protected by standard Render env-var secrecy | Until manually rotated in the Basiq dashboard | Manual, via Basiq's dashboard | **Cannot move money or log into any bank.** It authenticates FrodoCodo's own server to Basiq's API — an attacker with only this key could create/query Basiq users and connections under FrodoCodo's Basiq account (a real but bounded blast radius: they could see whatever households have connected accounts, i.e. this one household in practice, and could initiate new consent flows), but Basiq's CDR role means even Basiq itself cannot originate a payment through this class of API key — payment initiation is a structurally separate, separately-accredited CDR capability ("Action Initiation") that Basiq's read/transaction-data product doesn't include and FrodoCodo would never request (§2b). |
| CDR OAuth access token + refresh token (per household connection, CBA/Virgin) | Would be a new column on `FinancialConnection` (doesn't exist yet — today's schema has no token column at all, since no real provider is wired up) | **Must be encrypted at the application level** (same `encryptForStorage` pattern already built for H3/rawProviderPayload, reused rather than reinvented) — this is the single most sensitive row in the schema once live, more sensitive than the raw payload question in §4. | CDR access tokens are short-lived (data-holder-set, commonly minutes-to-hours); refresh tokens live for the consent's duration, and CDR consents have a **mandatory maximum duration the household can see and must actively renew** (data holders are required to support this under the CDR rules) — unlike a bank's own indefinite internet-banking session. | Revocable by the household **at the bank's own online banking portal or via Basiq**, independently of FrodoCodo's own "disconnect" button (`FinancialConnection.consentStatus = REVOKED`, already implemented) — CDR consent revocation is a data-holder-side guarantee, not something only FrodoCodo's code enforces. | **Cannot log into internet banking, cannot initiate a payment, cannot change bank settings.** A CDR access token is scoped, at the protocol level, to exactly the read scopes it was issued for (§2a) — this is enforced by the data holder (the bank), not by FrodoCodo's honesty. An attacker holding a stolen token could re-pull the same read-only transaction/account data FrodoCodo itself can see, for as long as the token remains valid before the household revokes it or it naturally expires — a real privacy breach, but categorically not a banking-control breach. This must be verified against CBA's and Virgin Money's actual CDR token-scope enforcement at implementation time (not something to take purely on this audit's word), but is a structural property of the CDR standard itself, not an institution-specific behavior. |
| Amex non-CDR session/credential-derived token (Basiq's representation of an ongoing "Connect"-based link) | Same column pattern as above, same encryption requirement | **Must be encrypted at rest**, and treated as **more sensitive than the CDR tokens** above, since its exact capability boundary is set by Basiq's implementation, not by a public regulatory standard FrodoCodo can independently verify. | Set by Basiq's own session/link lifetime for non-CDR connections — must be confirmed from Basiq's docs before implementation (see §9). | Household-side: re-entering/changing the Amex online banking password should implicitly break Basiq's stored session; FrodoCodo's own "disconnect" action must also call Basiq's disconnect API, not just flip a local flag. | **Should not** enable internet-banking login or payment initiation, since Basiq's stated role is read-only account aggregation, but — unlike the CDR case — this is a **vendor promise to verify contractually/technically**, not a regulator-enforced protocol guarantee. This is the single weakest link in the entire threat model and is called out again in §9. |
| Amex (or any institution's) raw login credential | **Nowhere. Must never exist in FrodoCodo at all** (§2c). | N/A | N/A | N/A | N/A — this row exists in the table specifically to state that it must stay empty; if any implementation detail ever causes FrodoCodo's own code to see this value, that is an immediate stop-ship defect, not a threat to merely mitigate. |

**Hard requirement verification**: the CDR standard's whole regulatory
premise is that data sharing and payment initiation are separate,
separately-accredited capabilities (Action Initiation is a distinct,
much newer, opt-in CDR extension that most data holders/ADRs — including,
as far as this research could determine, Basiq's current product — do not
implement at all). Basiq's product as researched is a **read** aggregator;
nothing in its documented capability set includes payment initiation. This
satisfies the task's hard requirement structurally (FrodoCodo can't
request a capability its aggregator doesn't offer), but the Amex
non-CDR row above is the one place this audit could not fully verify
independently and flags for contractual/technical confirmation rather than
asserting as proven.

---

## 9. Breach blast-radius table

### Scenario A: attacker obtains a full copy of the production database + application source code

| | Detail |
|---|---|
| **Reads immediately (plaintext)** | Household composition (`User`/`Household`), category/bucket structure, transaction amounts, dates, normalised merchant/description strings, budget allocations, savings goals, income sources' *expected* amounts, AI insight text, audit log entries, account balances, account type + FrodoCodo-chosen alias (e.g. "CBA", "Virgin", "Amex"), consent status/timestamps. **This is genuinely sensitive** — a household's full spending history and financial planning — and this audit does not pretend otherwise; it is exactly the "private household spending information" the task's own target risk statement accepts as exposed in a catastrophic breach. |
| **Encrypters would encounter (ciphertext only, useless without the separate key)** | The CDR/Amex access & refresh tokens (§8), and, under the current H3 design, `rawProviderPayload` — though §4 recommends removing this as a standing column once live, which would remove it from this row entirely rather than merely keeping it encrypted. Bcrypt password hashes (already the case today, unrelated to banking). |
| **FrodoCodo deliberately never possesses (not in this breach at all, because it was never requested/stored)** | Full/unmasked account numbers, BSBs, legal name on the bank account, address, phone/email as held by the bank, DOB, card numbers, payee lists, scheduled-payment/direct-debit authority data, the household's actual bank-login credentials for any institution. |
| **Actions the attacker could perform with DB + source alone** | Read every household's private financial history (severe privacy breach). Nothing else, structurally — read-only data plus source code doesn't grant network access to Basiq or any bank; the attacker would need the *running application's* live environment variables (a separate, further compromise) to even attempt to use an encrypted token, and even then would only regain read access to the same transaction data already sitting in the breached database — no incremental capability gained from also holding the token in this scenario, since decrypting it requires the encryption key, which per this design is not itself in the database. |
| **Actions the attacker could not perform** | Log into any bank's internet banking. Move money. Initiate a payment. Change any bank account setting. Impersonate the household to the bank. |

### Scenario B: attacker additionally obtains FrodoCodo's live banking-provider credential/token (i.e., the encryption key *and* an active CDR/Amex token, or direct access to the running application's environment)

| | Detail |
|---|---|
| **Additional reads gained** | The ability to decrypt the stored token(s) and, using them, re-pull the same read-only transaction/account data directly from Basiq/the bank for as long as the token remains valid — functionally the same data already in the breached database (Scenario A), just re-derivable from source instead of at rest. For CDR connections this access is time-boxed by the consent's own maximum duration and is independently revocable by the household at the bank (§8) — it does not persist indefinitely just because the attacker has it once. |
| **Actions gained** | None beyond re-reading the same transaction/account data. Per §8's structural analysis, a CDR read-scoped token cannot originate a payment, and Basiq's product (as researched) has no payment-initiation capability to escalate into even with valid credentials to its API. |
| **Actions still not possible** | Everything in Scenario A's "could not perform" row still holds. **This is the design target the task asks this audit to prove, and this analysis supports it**: even the strongest realistic compromise (full DB + source + live token) degrades to "worse privacy breach," not "attacker now controls the bank accounts or can move money" — because the tokens FrodoCodo would ever hold are, by construction (§2, §8), read-scoped CDR tokens or a read-only aggregator's session state, never a banking-login credential or a payment-capable grant. |

**One caveat this table must carry honestly**: the Amex non-CDR pathway's
guarantee here rests on Basiq's own implementation being read-only, which
this audit corroborated but could not directly verify against Basiq's
primary documentation from this sandbox (§10 below repeats this as the
top unresolved item). The CDR-pathway guarantee (CBA, Virgin) rests on a
public regulatory standard's structural separation of read and
payment-initiation capabilities, which is a stronger form of assurance
than a single vendor's product design.

---

## 10. Unresolved risks / questions (carried forward, not resolved by desk research alone)

1. **Amex's exact CDR designation status and date** — could not confirm
   from this sandbox whether Amex AU is captured in the non-bank-lenders
   sector's "initial providers" cohort (9 Nov 2026) or a later one, or
   whether it's designated at all yet. Re-check `cdr.gov.au/find-a-provider`
   directly before scoping any Amex work.
2. **Basiq's exact Connect-widget credential-custody guarantee for Amex
   specifically** — corroborated as a hosted-widget pattern generally, but
   not verified against Basiq's current Amex-specific integration
   documentation. This is the single highest-priority item to confirm
   before Amex is connected, since §8's threat model for Amex rests on it.
3. **Exact CDR banking scope string spelling** — the scope names used
   throughout this document (`bank:accounts.basic:read`-class,
   `bank:transactions:read`-class, etc.) are corroborated but not verified
   character-for-character against the live Consumer Data Standards
   register from this sandbox; confirm exact strings when writing the
   actual Basiq client configuration.
4. **CBA offset-account product-category confirmation** — confirm the
   specific offset product the household holds is exposed under CDR with
   the same fidelity as a plain transaction account, via CBA's live CDR
   product reference data or Basiq's mirrored institution metadata.
5. **Reversed-transaction handling** (§7) is a genuine design gap, not
   just a research gap — needs a concrete dedupe/netting rule designed
   (and tested, per CLAUDE.md's testing expectations for `packages/ledger`)
   before live data can exercise it correctly.
6. **CDR consent-token lifetime specifics per data holder** (§8) —
   "commonly minutes-to-hours" for access tokens and a data-holder-set
   maximum consent duration are general CDR-standard properties; CBA's and
   Virgin Money's actual configured values should be confirmed during
   integration testing rather than assumed.

---

## 11. Binary recommendation

# DO NOT PROCEED YET

Not because the architecture is wrong — the minimisation design in §2–§7
is sound, achievable with the existing `FinancialDataProvider` interface
with only the concrete, listed adjustments (household-confirmed alias
instead of provider nickname, normalised-not-verbatim description storage,
removing `rawProviderPayload` as a standing column, adding reversed-
transaction handling) — but because two facts material to the design are
not yet independently confirmed and this audit's own instructions require
stopping before proceeding on an unconfirmed factual foundation:

1. Amex's actual CDR/non-CDR status and, if non-CDR, Basiq's precise
   credential-custody mechanism for it (items 1–2 in §10) — this
   determines whether Amex can be connected under the same threat model
   as CBA/Virgin at all, or needs its own explicit household-facing
   disclosure of a materially different (higher-trust-in-Basiq) connection
   method, which `docs/provider-integration.md`'s `connectionMethod` field
   already anticipates but which this audit could not finish verifying.
2. Exact CDR scope strings and CBA's offset-account product-category
   behavior (items 3–4 in §10) — needed to write a correct Basiq client
   configuration, not merely a plausible one.

**Recommended next step**: from a network without this sandbox's egress
restrictions, confirm items 1–4 in §10 directly against
`cdr.gov.au/find-a-provider`, Basiq's live API docs, and CBA/Virgin
Money's own CDR product reference data. Once those are confirmed (or
confirmed-and-adjusted-for), this audit's §2–§8 design is ready to
implement as written, with the two concrete pre-implementation build
items from §5/§6/§7 (alias-not-nickname, normalised-not-verbatim
description, drop the raw-payload column, add reversed-transaction
handling) folded into that implementation work rather than treated as
follow-ups.
