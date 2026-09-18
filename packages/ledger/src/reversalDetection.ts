import type { TransactionDirection } from "@frodocodo/shared";
import { toMoney, type MoneyInput } from "@frodocodo/shared";

/**
 * Task 6A's specific gap: a same-account, equal-and-opposite reversal of a
 * card transaction (e.g. a purchase that's declined/reversed by the
 * merchant's own terminal, or a bank-initiated reversal) is neither a
 * cross-account transfer (transferDetection.ts requires two different
 * accounts) nor a merchant-matched refund (refundMatching.ts requires the
 * same normalized merchant and allows a much wider window, since a refund
 * is typically days-to-weeks after the original purchase).
 *
 * Task 6C hardening: the original version of this detector matched purely
 * on same-account + equal amount + opposite direction + a ≤2-day window,
 * with no textual or provider-supplied evidence at all. That's too weak —
 * two genuinely independent transactions can share an amount by
 * coincidence (a $50 fuel top-up and an unrelated $50 refund from
 * something else, both landing within two days), and silently netting
 * them to zero would erase real household spending, which is worse than
 * missing a real reversal (CLAUDE.md: never double-count spending — read
 * in the direction that also means never silently un-count it). This
 * detector now requires actual evidence, in strict preference order, and
 * returns no match at all rather than guess when neither tier is met:
 *
 *   Tier 1 — provider-supplied linkage: a source explicitly declares "this
 *   transaction reverses/links to provider transaction X"
 *   (reversalOfProviderTransactionId, populated only by a real source that
 *   actually supplies this — no adapter in this codebase does today). This
 *   is trusted directly (same account, opposite direction, as a sanity
 *   check) without requiring amount/date closeness, since the source
 *   itself is the evidence.
 *
 *   Tier 2 — deterministic textual evidence: same account, exactly equal
 *   magnitude, opposite direction, within the tight window, AND the later
 *   (reversal-side) transaction's own description contains an explicit,
 *   deterministic reversal-indicating keyword (REVERSAL, REVERSED, VOID,
 *   VOIDED, DECLINED, CANCELLED/CANCELED). This is a fixed keyword list,
 *   never fuzzy/AI matching, and deliberately does not consider merchant
 *   matching — a same-merchant, same-account debit-then-credit pattern is
 *   refundMatching.ts's job, not this detector's.
 *
 *   Otherwise: no match. A false negative (an unflagged reversal a
 *   household corrects manually) is the accepted cost of never risking a
 *   false positive that silently erases real spending.
 *
 * Only ever called with transactions already excluded from transfer
 * matching (a transaction can be at most one of: transfer leg, reversal
 * leg, refund leg) — see apps/worker/src/syncConnection.ts and
 * packages/db/src/seedHousehold.ts for the reconciliation order.
 */
export interface ReversalCandidate {
  id: string;
  accountId: string;
  /** This transaction's own stable provider/source ID, when it has one — needed to resolve another candidate's tier-1 linkage against it. */
  providerTransactionId: string | null;
  amount: MoneyInput; // positive magnitude
  direction: TransactionDirection;
  transactionDate: string; // YYYY-MM-DD
  /** Tier-1 evidence: this transaction's source explicitly declared it reverses/links to the OTHER transaction's providerTransactionId. */
  reversalOfProviderTransactionId?: string | null;
  /** This transaction's own description text — read only to check for the fixed reversal-keyword list (tier 2), never for merchant/fuzzy matching. */
  description?: string | null;
}

export interface ReversalMatch {
  /** The earlier transaction that got reversed. */
  originalTransactionId: string;
  /** The later, equal-and-opposite transaction that reverses it. */
  reversalTransactionId: string;
  /** Which tier of evidence produced this match — useful for audit/debugging, never displayed to end users. */
  evidence: "PROVIDER_LINKED" | "REVERSAL_KEYWORD";
}

const REVERSAL_MATCH_WINDOW_DAYS = 2;

// Deterministic, fixed keyword list — never fuzzy, never AI-guessed. Word
// boundaries so e.g. "AVOID" doesn't spuriously match "VOID".
const REVERSAL_KEYWORD_PATTERN = /\b(REVERSAL|REVERSED|VOID(?:ED)?|DECLINED?|CANCEL(?:L?ED)?)\b/i;

export function detectReversals(candidates: ReversalCandidate[]): ReversalMatch[] {
  const byAccount = new Map<string, ReversalCandidate[]>();
  for (const candidate of candidates) {
    const bucket = byAccount.get(candidate.accountId);
    if (bucket) bucket.push(candidate);
    else byAccount.set(candidate.accountId, [candidate]);
  }

  const usedIds = new Set<string>();
  const matches: ReversalMatch[] = [];

  for (const accountCandidates of byAccount.values()) {
    const byProviderTransactionId = new Map(
      accountCandidates.filter((c) => c.providerTransactionId).map((c) => [c.providerTransactionId!, c]),
    );

    // --- Tier 1: provider-supplied linkage, trusted directly. ---
    for (const candidate of accountCandidates) {
      if (usedIds.has(candidate.id)) continue;
      if (!candidate.reversalOfProviderTransactionId) continue;

      const linked = byProviderTransactionId.get(candidate.reversalOfProviderTransactionId);
      if (!linked || linked.id === candidate.id) continue;
      if (usedIds.has(linked.id)) continue;
      if (linked.direction === candidate.direction) continue; // sanity check: a reversal is opposite-signed

      const [original, reversal] =
        linked.transactionDate.localeCompare(candidate.transactionDate) <= 0 ? [linked, candidate] : [candidate, linked];

      usedIds.add(original.id);
      usedIds.add(reversal.id);
      matches.push({ originalTransactionId: original.id, reversalTransactionId: reversal.id, evidence: "PROVIDER_LINKED" });
    }

    // --- Tier 2: exact amount/window match + deterministic keyword evidence. ---
    const sorted = [...accountCandidates]
      .filter((c) => !usedIds.has(c.id))
      .sort((a, b) => a.transactionDate.localeCompare(b.transactionDate));

    for (let i = 0; i < sorted.length; i++) {
      const original = sorted[i]!;
      if (usedIds.has(original.id)) continue;

      let best: ReversalCandidate | null = null;
      let bestDistance = Infinity;

      for (let j = i + 1; j < sorted.length; j++) {
        const candidate = sorted[j]!;
        if (usedIds.has(candidate.id)) continue;
        if (candidate.direction === original.direction) continue; // must be opposite
        if (!toMoney(candidate.amount).equals(toMoney(original.amount))) continue;
        if (!REVERSAL_KEYWORD_PATTERN.test(candidate.description ?? "")) continue;

        const distance = daysBetween(original.transactionDate, candidate.transactionDate);
        if (distance < 0) continue; // reversal must not precede the original
        if (distance <= REVERSAL_MATCH_WINDOW_DAYS && distance < bestDistance) {
          best = candidate;
          bestDistance = distance;
        }
      }

      if (best) {
        usedIds.add(original.id);
        usedIds.add(best.id);
        matches.push({ originalTransactionId: original.id, reversalTransactionId: best.id, evidence: "REVERSAL_KEYWORD" });
      }
    }
  }

  return matches;
}

function daysBetween(a: string, b: string): number {
  return (Date.parse(b) - Date.parse(a)) / 86_400_000;
}
