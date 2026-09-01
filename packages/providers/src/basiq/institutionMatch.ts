import type { BasiqInstitution } from "./types.js";
import { SUPPORTED_INSTITUTIONS } from "./scopes.js";

/**
 * Resolves CBA/Virgin Money against Basiq's LIVE institutions list by
 * name — deliberately never a hardcoded institution ID. Task 6A's audit
 * and this task's own verification pass could not confirm Basiq's exact
 * current institution ID for either bank from this environment (network
 * access to basiq.io/api.basiq.io is blocked here — see
 * docs/basiq-integration.md), and a wrong hardcoded ID would either fail
 * silently or, worse, connect to the wrong institution. Querying live and
 * matching by name is also simply the more robust design regardless —
 * aggregator institution IDs are opaque and can change; the institution's
 * public name does not.
 *
 * Task 7A.1 correction: the original matcher used a substring `.includes()`
 * comparison against a single loose name per institution — that risks a
 * false-positive match against an unrelated institution whose name happens
 * to contain the target text (e.g. "Virgin Money" substring-matching some
 * unrelated "New Virgin Islands Bank"-shaped name), and Task 7A.1 explicitly
 * called this out as needing correction. This version instead does
 * case-insensitive EXACT matching against a short, human-reviewed
 * allow-list of approved full/short names per institution
 * (`SUPPORTED_INSTITUTIONS` in scopes.ts), and — just as importantly —
 * fails closed if more than one live institution matches a given target's
 * allow-list: it throws rather than silently picking `.find()`'s first
 * result, because a silent pick could connect the household to the wrong
 * institution with no visible warning. Zero matches is not an error (it's
 * the expected, acceptable state until real Basiq API access exists to
 * confirm exact institution IDs) and returns `null` for that institution.
 */
export function findSupportedInstitutions(institutions: BasiqInstitution[]): {
  cba: BasiqInstitution | null;
  virgin: BasiqInstitution | null;
} {
  return {
    cba: matchOne(institutions, "CBA", [SUPPORTED_INSTITUTIONS.CBA.shortName, ...SUPPORTED_INSTITUTIONS.CBA.approvedNames]),
    virgin: matchOne(institutions, "Virgin", [SUPPORTED_INSTITUTIONS.VIRGIN.shortName, ...SUPPORTED_INSTITUTIONS.VIRGIN.approvedNames]),
  };
}

function matchOne(institutions: BasiqInstitution[], label: string, approvedNames: readonly string[]): BasiqInstitution | null {
  const approved = new Set(approvedNames.map((n) => n.toLowerCase()));
  const matches = institutions.filter((i) => approved.has(i.name.toLowerCase()) || approved.has(i.shortName.toLowerCase()));

  if (matches.length > 1) {
    throw new Error(
      `Ambiguous institution match for ${label}: ${matches.length} live Basiq institutions matched the approved name allow-list ` +
        `(${matches.map((m) => m.id).join(", ")}). Refusing to guess — update SUPPORTED_INSTITUTIONS in scopes.ts to disambiguate ` +
        `before connecting.`,
    );
  }

  return matches[0] ?? null;
}
