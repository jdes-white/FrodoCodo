/**
 * Categorisation closure pass, requirement 2/5: not every transaction is
 * spending. This module never *excludes* anything from budget totals by
 * itself (only `transferDetection.ts`'s confirmed-pair matching does that,
 * post-insert, once both legs of a real transfer are known) — it only
 * decides, at classification time and from the raw description alone,
 * whether a single-leg transaction is confident or uncertain enough that
 * it should be kept out of the AI categorisation batch entirely, since
 * asking a model to invent a *spending* category for a salary deposit or an
 * inter-account transfer would be actively wrong, not just low-confidence.
 *
 * Deliberately generic (household-agnostic keyword patterns), not tied to
 * any specific real transaction batch — see CLAUDE.md's "never build a
 * brittle rule tied to one household's exact descriptions" principle.
 * Deliberately conservative: loan repayments, BPAY bill payments, and
 * direct debits are NOT matched here, because those are legitimate
 * budget-trackable spend for most households and misclassifying them as
 * "not spending" would silently exclude real expenditure (the one failure
 * mode explicitly called out as unacceptable).
 */

export type FinancialMovementSignal = "ORDINARY" | "CONFIDENT_NON_SPEND" | "UNCERTAIN_NON_SPEND";

export interface FinancialMovementCandidate {
  originalDescription: string;
  direction: "DEBIT" | "CREDIT";
}

// A CREDIT whose description names it as an employer payment. Confident
// because no legitimate household budget category represents "my own
// income" as a spending line — there is no safe interpretation where this
// should be auto-categorised as an expense the way a merchant purchase
// would be.
const INCOME_PATTERN = /\b(SALARY|SALARIES|PAYROLL|PAY\s?ROLL|WAGES?)\b/i;

// Generic internal-transfer language. Present on both DEBIT and CREDIT legs
// of a genuine inter-account move, but — unlike income — cannot be trusted
// as confidently non-spend from the description alone: "TRANSFER TO" a
// merchant-style biller reference, or a transfer that's actually a payment
// to a person for goods/services, both use the same words. Treated as
// *uncertain* rather than confident so it lands in review instead of being
// silently excluded (the explicit conservative instruction).
const TRANSFER_LANGUAGE_PATTERN = /\b(TRANSFER|XFER|TFR)\b.{0,20}\b(TO|FROM)\b|\b(TO|FROM)\b.{0,20}\b(TRANSFER|XFER|TFR)\b/i;

/**
 * Pure, description-only classification — no database, no merchant history.
 * The caller (`classifyTransactionBatch`) only consults this for items the
 * deterministic layers (household rule, learned mapping) haven't already
 * confidently resolved; an explicit household decision always wins over
 * this generic heuristic, by construction of the call order.
 */
export function classifyFinancialMovement(candidate: FinancialMovementCandidate): FinancialMovementSignal {
  const description = candidate.originalDescription;

  if (candidate.direction === "CREDIT" && INCOME_PATTERN.test(description)) {
    return "CONFIDENT_NON_SPEND";
  }

  if (TRANSFER_LANGUAGE_PATTERN.test(description)) {
    return "UNCERTAIN_NON_SPEND";
  }

  return "ORDINARY";
}
