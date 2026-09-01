# Financial provider integration

## Current state

`packages/providers` ships two adapters implementing the
`FinancialDataProvider` interface (`packages/providers/src/types.ts`):

- `MockProvider` — deterministic synthetic data shaped like the three
  target products, used for all demo/dev/test purposes.
- `BasiqProvider` (Task 7A, corrected in Task 7A.1,
  `packages/providers/src/basiq/`) — a real adapter for **CBA and Virgin
  Money only** (Amex remains out of scope — see below). **Implemented but
  never connected**: no real Basiq API key has ever been used, no real
  Basiq user created, no real CDR consent requested, no real account
  connected. See `docs/basiq-integration.md` for the full architecture,
  the corrected API-token-scope-vs-CDR-consent-scope model, the Consent UI
  URL builder, the multi-institution household model, the token security
  design, and every item that could not be verified against live Basiq
  documentation from the environment this was built in.

Connecting a REAL account for the first time is still a deliberate,
owner-present decision (see `docs/product-decisions.md`) — the interface
being implemented doesn't change that; it means the remaining work is
configuration and live verification (see `docs/basiq-integration.md`'s
unresolved pre-live items), not a rewrite.

## Target products — verified, not assumed

The spec explicitly required confirming aggregator coverage per product
rather than assuming it from institution name alone. Findings (August 2026):

| Product | Institution | CDR status | Notes |
|---|---|---|---|
| Transaction account | Commonwealth Bank of Australia | **CDR data holder** (major bank, mandatory) | Full CDR support via any accredited aggregator. |
| Velocity High Flyer credit card | Virgin Money Australia | **CDR data holder** | Confirmed via Virgin Money's own Open Banking page. **Precondition**: the card must be registered in the Virgin Money mobile app before it becomes shareable via CDR — flag this to the household during connection, it's outside the app's control. |
| Velocity-linked card | American Express Australia | **Not yet a CDR data holder** | Non-bank card issuers are scheduled to join CDR from **9 November 2026**. Until then, Amex is only reachable via a non-CDR "connect" (credential-based) pathway that some accredited aggregators offer alongside their CDR product. |

This is reflected in the data model:
`FinancialConnection.connectionMethod` is `CDR` for CBA and Virgin Money,
`CREDENTIAL_BASED` for Amex — disclosed to the household in Settings rather
than presented as uniformly "connected via secure bank login."

## Recommended aggregator: Basiq

Basiq is an ACCC-accredited Data Recipient under the CDR, now a Cuscal
subsidiary, covering ~136 AU/NZ institutions including all CDR data holders.
It also offers a non-CDR connect pathway for institutions (like Amex today)
that haven't joined CDR yet — meaning one aggregator can serve all three
target products through the interface below, with Amex automatically
eligible to move to the CDR pathway once it joins in November 2026 (a config
change on Basiq's side, not ours).

Before wiring this for real: re-verify Basiq's current Amex AU coverage
against their live supported-institutions list — aggregator coverage changes
faster than any document can track, and this is exactly the kind of claim
the original spec asked not to take on faith.

## What `BasiqProvider` implements

See `docs/basiq-integration.md` for the full writeup. Summary: every
method `FinancialDataProvider` declares, mapping Basiq's API to our
normalized shape — `listSupportedInstitutions` resolves CBA/Virgin by name
against Basiq's live institutions list (never a hardcoded ID);
`discoverAccounts`/`syncTransactions` map Basiq's account/transaction
shape into `ProviderAccount`/`ProviderTransaction`, with nothing
downstream ever persisting a raw Basiq response — every ingestion call
site maps through `packages/ledger/src/ingestion.ts`'s allow-list
functions first (Task 6B/6C); account aliasing still goes through
`deriveDefaultAccountAlias`, never Basiq's own nickname string;
`disconnectConnection` calls Basiq's revoke endpoint, and the disconnect
action clears any stored token locally regardless of that call's outcome.

As designed from the start: none of `packages/ledger`, `packages/domain`,
`apps/web`, or `apps/worker` needed to change to consume this adapter —
they only ever see the normalized interface, confirmed by this
implementation rather than just assumed.

## Amex remains out of scope

Task 7A implemented CBA and Virgin only. Amex stays manual/screenshot-based
until its non-CDR connection path (Basiq's credential-relay "Connect"
pathway, or Amex's eventual CDR participation) is separately verified —
see `docs/banking-data-minimisation-audit.md` for why that path carries a
materially different trust model than CBA/Virgin's CDR-based one.

## Required environment for a real deployment

```
FINANCIAL_PROVIDER="basiq"
BASIQ_API_KEY="<household's own Basiq API key>"
```

See `.env.example`. `BASIQ_API_KEY` must be a server-side secret (Basiq
dashboard credentials, never a client-exposed value) — see
`docs/security-privacy.md`.
