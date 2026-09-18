import type { TransactionDirection, TransactionStatus } from "@frodocodo/shared";
import { toMoney, type Money } from "@frodocodo/shared";

/**
 * Screenshot-import dedupe (batch screenshot ingestion task).
 *
 * Screenshots never carry a stable `providerTransactionId` the way a real
 * provider sync does — `dedupe.ts`'s exact-ID path is unavailable, and its
 * own doc comment already flags this exact gap ("Closing this gap safely
 * needs either a real shared stable key across sources... or a
 * household-facing 'possible duplicate — confirm' review step... both are
 * future work, not attempted here"). This module is that future work,
 * scoped specifically to screenshot-sourced candidates, which additionally
 * need to be deduplicated *against each other* within one upload batch
 * (`dedupe.ts`'s `resolveDedupe` only ever compares one candidate against
 * already-persisted rows).
 *
 * Design: two transactions are a STRONG match only when their descriptions
 * are (near-)identical AND their account/amount/direction/date line up —
 * strong matches are clustered (union-find) and resolved automatically,
 * using a "multiset floor" rule: if a single screenshot shows a fingerprint
 * N times, there are genuinely at least N real transactions (a bank's own
 * transaction list never shows one real transaction twice within itself),
 * so the floor for a cluster is `max(existing count, the largest per-
 * screenshot count)` — this is what lets two genuinely-identical purchases
 * on the same statement page survive intact while overlapping screenshots
 * of the *same* transaction still collapse to one. A WEAK match (same
 * account/amount/direction/date window, but descriptions only partially
 * agree) is never auto-collapsed and never silently kept as a plain
 * insert either — it's flagged `NEEDS_REVIEW` so a human, not a fuzzy
 * heuristic, makes the call.
 */

export interface ScreenshotDedupeItem {
  accountId: string;
  transactionDate: string; // YYYY-MM-DD
  amount: Money;
  direction: TransactionDirection;
  status: TransactionStatus;
  /** The source's own (or normalized) description text — used for similarity, not persisted by this module. */
  description: string;
}

export interface ScreenshotDedupeExisting extends ScreenshotDedupeItem {
  id: string;
}

export interface ScreenshotDedupeCandidate extends ScreenshotDedupeItem {
  /** Identifies which single screenshot this candidate came from — the multiset floor is computed per source. */
  sourceKey: string;
  /** 0-1; used only as a tiebreak among otherwise-equal candidates when choosing which one to keep. */
  confidence: number;
}

export type ScreenshotDedupeOutcome =
  | { action: "INSERT" }
  | { action: "SKIP_DUPLICATE"; matchedExistingId: string }
  | { action: "UPDATE_STATUS_TO_POSTED"; matchedExistingId: string }
  /** Duplicate-of-another-new-candidate-in-this-batch — resolve once the kept candidate's real id exists. */
  | { action: "SKIP_DUPLICATE_OF_CANDIDATE"; matchedCandidateIndex: number }
  | { action: "NEEDS_REVIEW"; possibleDuplicateOfExistingId?: string; possibleDuplicateOfCandidateIndex?: number };

const SAME_STATUS_DATE_WINDOW_DAYS = 1;
const PENDING_TO_POSTED_DATE_WINDOW_DAYS = 5;

/**
 * Resolves an entire batch of screenshot-sourced candidates against both
 * each other and the household's existing transactions for the relevant
 * accounts, in one pass. Order-independent: the result never depends on
 * the order `candidates` are supplied in (screenshots arrive in "completely
 * random order" per spec) — ties are broken deterministically (posted over
 * pending, then higher extraction confidence, then array index).
 */
export function resolveScreenshotBatch(
  candidates: ScreenshotDedupeCandidate[],
  existing: ScreenshotDedupeExisting[],
): ScreenshotDedupeOutcome[] {
  const n = candidates.length;
  const outcomes: (ScreenshotDedupeOutcome | undefined)[] = new Array(n);

  // Union-find over candidate indices, clustering only STRONG matches.
  const parent = Array.from({ length: n }, (_, i) => i);
  function find(i: number): number {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!;
      i = parent[i]!;
    }
    return i;
  }
  function union(a: number, b: number): void {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  }

  // candidateIndex -> strong-matched existing ids (rare to have >1, but possible)
  const candidateStrongExisting = new Map<number, Set<string>>();
  // candidateIndex -> weak-matched existing ids
  const candidateWeakExisting = new Map<number, Set<string>>();
  // candidateIndex -> weak-matched candidate indices (for cross-candidate review flagging)
  const candidateWeakCandidates = new Map<number, Set<number>>();

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const match = compare(candidates[i]!, candidates[j]!);
      if (match === "STRONG") union(i, j);
      else if (match === "WEAK") {
        if (!candidateWeakCandidates.has(i)) candidateWeakCandidates.set(i, new Set());
        candidateWeakCandidates.get(i)!.add(j);
      }
    }
    for (const ex of existing) {
      const match = compare(candidates[i]!, ex);
      if (match === "STRONG") {
        if (!candidateStrongExisting.has(i)) candidateStrongExisting.set(i, new Set());
        candidateStrongExisting.get(i)!.add(ex.id);
      } else if (match === "WEAK") {
        if (!candidateWeakExisting.has(i)) candidateWeakExisting.set(i, new Set());
        candidateWeakExisting.get(i)!.add(ex.id);
      }
    }
  }

  // Group candidate indices by cluster root, then also fold in any existing
  // rows any cluster member strong-matched.
  const clusters = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    if (!clusters.has(root)) clusters.set(root, []);
    clusters.get(root)!.push(i);
  }

  for (const members of clusters.values()) {
    const existingIds = new Set<string>();
    for (const m of members) for (const id of candidateStrongExisting.get(m) ?? []) existingIds.add(id);
    const existingRows = existing.filter((e) => existingIds.has(e.id));

    // A cluster with exactly one candidate and no strong-matched existing
    // row isn't really a "duplicate group" at all — it's just a candidate
    // that never strong-matched anything. Falling through to the multiset
    // logic below would always resolve it to a plain INSERT before its
    // WEAK matches (if any) ever get a chance to flag it for review, so
    // handle that case separately, first.
    if (members.length === 1 && existingRows.length === 0) {
      const only = members[0]!;
      const weakExisting = candidateWeakExisting.get(only);
      const weakCandidates = candidateWeakCandidates.get(only);
      if (weakExisting?.size) {
        outcomes[only] = { action: "NEEDS_REVIEW", possibleDuplicateOfExistingId: [...weakExisting][0] };
      } else if (weakCandidates?.size) {
        outcomes[only] = { action: "NEEDS_REVIEW", possibleDuplicateOfCandidateIndex: [...weakCandidates][0] };
      } else {
        outcomes[only] = { action: "INSERT" };
      }
      continue;
    }

    const bySource = new Map<string, number[]>();
    for (const m of members) {
      const key = candidates[m]!.sourceKey;
      if (!bySource.has(key)) bySource.set(key, []);
      bySource.get(key)!.push(m);
    }
    const maxPerScreenshot = Math.max(0, ...[...bySource.values()].map((v) => v.length));
    const target = Math.max(existingRows.length, maxPerScreenshot);

    // Deterministic ranking: posted before pending, then higher confidence,
    // then lower index — this decides which candidates get "kept" (inserted
    // or used to post-ify an existing row) when a cluster has more members
    // than its target count.
    const ranked = [...members].sort((a, b) => {
      const ca = candidates[a]!;
      const cb = candidates[b]!;
      if (ca.status !== cb.status) return ca.status === "POSTED" ? -1 : 1;
      if (ca.confidence !== cb.confidence) return cb.confidence - ca.confidence;
      return a - b;
    });

    const pendingExisting = existingRows.filter((e) => e.status === "PENDING");
    const hasPostedCandidate = ranked.some((m) => candidates[m]!.status === "POSTED");

    let keptSoFar = 0;
    const newSlotsAvailable = Math.max(0, target - existingRows.length);
    let newSlotsUsed = 0;
    let postedExistingUsed = false;
    const keeperIndexForSkips: number[] = []; // candidate indices that were newly INSERTed, for later SKIP_DUPLICATE_OF_CANDIDATE references

    for (const m of ranked) {
      if (existingRows.length > 0 && pendingExisting.length > 0 && hasPostedCandidate && !postedExistingUsed && candidates[m]!.status === "POSTED") {
        outcomes[m] = { action: "UPDATE_STATUS_TO_POSTED", matchedExistingId: pendingExisting[0]!.id };
        postedExistingUsed = true;
        keptSoFar++;
        continue;
      }
      if (newSlotsUsed < newSlotsAvailable) {
        outcomes[m] = { action: "INSERT" };
        keeperIndexForSkips.push(m);
        newSlotsUsed++;
        keptSoFar++;
        continue;
      }
      // Not needed to reach the target — it's a duplicate of whatever we already kept.
      if (existingRows.length > 0) {
        outcomes[m] = { action: "SKIP_DUPLICATE", matchedExistingId: existingRows[0]!.id };
      } else if (keeperIndexForSkips.length > 0) {
        outcomes[m] = { action: "SKIP_DUPLICATE_OF_CANDIDATE", matchedCandidateIndex: keeperIndexForSkips[0]! };
      } else {
        // target was 0 members somehow reached here — shouldn't happen, but insert rather than lose data.
        outcomes[m] = { action: "INSERT" };
      }
    }
    void keptSoFar;
  }

  // Anything not covered by a strong cluster is a plain INSERT, unless it
  // has a WEAK match worth flagging for review.
  for (let i = 0; i < n; i++) {
    if (outcomes[i]) continue;
    const weakExisting = candidateWeakExisting.get(i);
    const weakCandidates = candidateWeakCandidates.get(i);
    if (weakExisting?.size) {
      outcomes[i] = { action: "NEEDS_REVIEW", possibleDuplicateOfExistingId: [...weakExisting][0] };
    } else if (weakCandidates?.size) {
      outcomes[i] = { action: "NEEDS_REVIEW", possibleDuplicateOfCandidateIndex: [...weakCandidates][0] };
    } else {
      outcomes[i] = { action: "INSERT" };
    }
  }

  // A cluster member that got INSERT/UPDATE but ALSO carries an independent
  // weak signal against something outside its own strong cluster is still
  // worth a lighter-touch flag — but strong-cluster resolution already
  // answers the question with more confidence, so we deliberately don't
  // downgrade INSERT/UPDATE_STATUS_TO_POSTED to NEEDS_REVIEW here.

  return outcomes as ScreenshotDedupeOutcome[];
}

type MatchStrength = "STRONG" | "WEAK" | "NONE";

function compare(a: ScreenshotDedupeItem, b: ScreenshotDedupeItem): MatchStrength {
  if (a.accountId !== b.accountId) return "NONE";
  if (a.direction !== b.direction) return "NONE";
  if (!toMoney(a.amount).equals(toMoney(b.amount))) return "NONE";

  const dayDelta = Math.abs(daysBetween(a.transactionDate, b.transactionDate));
  const sameStatus = a.status === b.status;
  const withinWindow = sameStatus ? dayDelta <= SAME_STATUS_DATE_WINDOW_DAYS : dayDelta <= PENDING_TO_POSTED_DATE_WINDOW_DAYS;
  if (!withinWindow) return "NONE";

  const descMatch = describeSimilarity(a.description, b.description);
  if (descMatch === "STRONG") return "STRONG";
  if (descMatch === "WEAK") return "WEAK";
  return "NONE";
}

function normalizeDescription(s: string): string {
  return s.trim().toUpperCase().replace(/\s+/g, " ");
}

/**
 * STRONG: identical once normalized, or one is a substantial (>=6 char)
 * prefix of the other — handles a screenshot's description being cut off
 * or wrapped differently between two captures of the same row. WEAK:
 * anything else that isn't a clean NONE (e.g. shares a long common prefix
 * shorter than the "substantial" threshold, or shares most but not all
 * tokens) — genuinely ambiguous, not confidently the same, not confidently
 * different.
 */
function describeSimilarity(rawA: string, rawB: string): MatchStrength {
  const a = normalizeDescription(rawA);
  const b = normalizeDescription(rawB);
  if (a === b) return "STRONG";
  if (a.length >= 6 && b.startsWith(a)) return "STRONG";
  if (b.length >= 6 && a.startsWith(b)) return "STRONG";

  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  if (shorter.length >= 4 && longer.includes(shorter)) return "WEAK";

  // Token-overlap fallback for descriptions that don't share a clean prefix
  // (e.g. OCR/vision misread a middle token) but clearly share most words.
  const tokensA = new Set(a.split(" ").filter((t) => t.length > 1));
  const tokensB = new Set(b.split(" ").filter((t) => t.length > 1));
  if (tokensA.size === 0 || tokensB.size === 0) return "NONE";
  let shared = 0;
  for (const t of tokensA) if (tokensB.has(t)) shared++;
  const overlapRatio = shared / Math.min(tokensA.size, tokensB.size);
  if (overlapRatio >= 0.6) return "WEAK";

  return "NONE";
}

function daysBetween(a: string, b: string): number {
  return (Date.parse(b) - Date.parse(a)) / 86_400_000;
}
