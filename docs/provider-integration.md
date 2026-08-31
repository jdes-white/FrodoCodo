# Financial provider integration

## Current state

`packages/providers` ships one adapter — `MockProvider` — implementing the
`FinancialDataProvider` interface (`packages/providers/src/types.ts`) with
deterministic synthetic data shaped like the three target products. No real
bank credentials, no live aggregator account, are used or required anywhere
in this repo.

This was a deliberate scope decision for this build (see
`docs/product-decisions.md`): connecting real accounts requires the
household's own aggregator account and sign-off on live credential handling,
which isn't something that should happen without the owner present. The
interface is designed so adding that adapter later is additive, not a
rewrite.

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

## What a `BasiqProvider` adapter needs to implement

Everything in `FinancialDataProvider` (`packages/providers/src/types.ts`),
mapping Basiq's API to our normalized shape:

- `listSupportedInstitutions()` → Basiq's institutions list, filtered to
  what the household might plausibly connect.
- `initiateConnection(institutionId)` → Basiq's connection/consent flow;
  return whatever `redirectUrl` the household needs to complete an
  OAuth-style CDR consent (or credential entry for the non-CDR pathway).
- `getConsentStatus(providerConnectionId)` → poll or webhook-receive Basiq's
  consent status, map to our `ConsentStatus` enum (`PENDING` / `ACTIVE` /
  `EXPIRING` / `EXPIRED` / `REVOKED`).
- `discoverAccounts` / `syncTransactions` → map Basiq's account/transaction
  shape to `ProviderAccount`/`ProviderTransaction`. `ProviderTransaction.raw`
  may still carry Basiq's original response for the adapter's own use, but
  nothing downstream persists it: every ingestion call site maps into
  `packages/ledger/src/ingestion.ts`'s `NormalizedTransactionInput` first,
  whose allow-listed fields are the only thing that ever reaches the
  database (Task 6B — see `docs/banking-data-minimisation-audit.md`). Do
  not add a new field or code path that writes `raw`/the full Basiq
  response into any table.
- Account discovery must derive the household-facing `Account.alias` via
  `deriveDefaultAccountAlias` (`packages/ledger/src/accountAlias.ts`) from
  the institution's short name — never from Basiq's own account nickname
  string, which can embed a masked-account-number fragment.
- `disconnectConnection` → revoke consent via Basiq's API, not just locally.

None of `packages/ledger`, `packages/domain`, `apps/web`, or `apps/worker`
should need to change — they only ever see the normalized interface.

## Required environment for a real deployment

```
FINANCIAL_PROVIDER="basiq"
BASIQ_API_KEY="<household's own Basiq API key>"
```

See `.env.example`. `BASIQ_API_KEY` must be a server-side secret (Basiq
dashboard credentials, never a client-exposed value) — see
`docs/security-privacy.md`.
