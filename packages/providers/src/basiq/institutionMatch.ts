import type { BasiqInstitution } from "./types.js";
import { SUPPORTED_INSTITUTION_NAMES } from "./scopes.js";

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
 */
export function findSupportedInstitutions(institutions: BasiqInstitution[]): {
  cba: BasiqInstitution | null;
  virgin: BasiqInstitution | null;
} {
  return {
    cba: institutions.find((i) => matchesName(i, SUPPORTED_INSTITUTION_NAMES.CBA)) ?? null,
    virgin: institutions.find((i) => matchesName(i, SUPPORTED_INSTITUTION_NAMES.VIRGIN)) ?? null,
  };
}

function matchesName(institution: BasiqInstitution, target: string): boolean {
  const haystack = `${institution.name} ${institution.shortName}`.toLowerCase();
  return haystack.includes(target.toLowerCase());
}
