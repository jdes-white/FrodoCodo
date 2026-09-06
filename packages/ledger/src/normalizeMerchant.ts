/**
 * Turns ugly bank transaction descriptions into human-friendly merchant
 * names (§42) — WITHOUT ever discarding the original description, which the
 * caller must persist separately (§9). This is intentionally conservative:
 * a known-alias hit is exact; everything else falls back to light cleanup
 * rather than guessing, so we don't fabricate a misleading merchant name.
 */
export interface NormalizedMerchant {
  normalizedName: string;
  /** Stable lowercase key for grouping/deduping merchants across transactions. */
  matchKey: string;
  /** 1.0 for a known-alias hit, lower for generic cleanup-only normalization. */
  confidence: number;
}

// A starter household-agnostic alias table. In-product this is augmented by
// provider-enriched merchant data (Layer 3) and household MerchantRules (Layer 1),
// which both take precedence over this generic table.
const KNOWN_ALIASES: Array<{ pattern: RegExp; name: string }> = [
  { pattern: /\bWOOLWORTHS\b/i, name: "Woolworths" },
  { pattern: /\bCOLES\b/i, name: "Coles" },
  { pattern: /\bALDI\b/i, name: "Aldi" },
  { pattern: /\bBUNNINGS\b/i, name: "Bunnings" },
  { pattern: /\bNETFLIX\b/i, name: "Netflix" },
  { pattern: /\bSPOTIFY\b/i, name: "Spotify" },
  { pattern: /\bAMAZON PRIME\b/i, name: "Amazon Prime" },
  { pattern: /\bAMAZON\b/i, name: "Amazon" },
  { pattern: /\bBP\b/i, name: "BP" },
  { pattern: /\b(SHELL|COLES EXPRESS)\b/i, name: "Shell" },
  { pattern: /\b7-?ELEVEN\b/i, name: "7-Eleven" },
  { pattern: /\bUBER\s*EATS\b/i, name: "Uber Eats" },
  { pattern: /\bUBER\b(?!\s*EATS)/i, name: "Uber" },
  { pattern: /\bMENULOG\b/i, name: "Menulog" },
  { pattern: /\bDOORDASH\b/i, name: "DoorDash" },
  { pattern: /\bMCDONALD/i, name: "McDonald's" },
  { pattern: /\bKMART\b/i, name: "Kmart" },
  { pattern: /\bTARGET\b/i, name: "Target" },
  { pattern: /\bJB\s*HI-?FI\b/i, name: "JB Hi-Fi" },
  { pattern: /\bORIGIN ENERGY\b/i, name: "Origin Energy" },
  { pattern: /\bAGL\b/i, name: "AGL" },
  { pattern: /\bTELSTRA\b/i, name: "Telstra" },
  { pattern: /\bOPTUS\b/i, name: "Optus" },
  { pattern: /\bAUSTRALIA POST|AUSPOST\b/i, name: "Australia Post" },
  { pattern: /\bDAN MURPHY/i, name: "Dan Murphy's" },
  { pattern: /\bCHEMIST WAREHOUSE\b/i, name: "Chemist Warehouse" },
];

const PROVIDER_PREFIXES = /^(SQ|SP|PP|PAYPAL|VISA|MC|EFTPOS)\s*[*\-]\s*/i;
const TRAILING_REFERENCE = /\s+#?\d{3,}$/;
const TRAILING_CARD_LAST4 = /\s+CARD\s*\d{2,4}$/i;
const AU_STATE_SUFFIX = /\s+(NSW|VIC|QLD|WA|SA|TAS|ACT|NT)\s*AU$/i;
const AU_COUNTRY_SUFFIX = /\s+AU$/i;
const MULTI_SPACE = /\s{2,}/g;

export function normalizeMerchant(rawDescription: string): NormalizedMerchant {
  const trimmedRaw = rawDescription.trim();

  for (const alias of KNOWN_ALIASES) {
    if (alias.pattern.test(trimmedRaw)) {
      return {
        normalizedName: alias.name,
        matchKey: toMatchKey(alias.name),
        confidence: 1,
      };
    }
  }

  let cleaned = trimmedRaw
    .replace(PROVIDER_PREFIXES, "")
    .replace(AU_STATE_SUFFIX, "")
    .replace(AU_COUNTRY_SUFFIX, "")
    .replace(TRAILING_CARD_LAST4, "")
    .replace(TRAILING_REFERENCE, "")
    .replace(MULTI_SPACE, " ")
    .trim();

  if (cleaned.length === 0) cleaned = trimmedRaw;

  const titleCased = toTitleCase(cleaned);

  return {
    normalizedName: titleCased,
    matchKey: toMatchKey(titleCased),
    confidence: cleaned === trimmedRaw ? 0.4 : 0.7,
  };
}

function toTitleCase(value: string): string {
  return value
    .toLowerCase()
    .split(" ")
    .map((word) => (word.length <= 3 && word === word.toLowerCase() ? word : capitalize(word)))
    .map(capitalize) // keep short words capitalized too (e.g. "BP", "IGA")
    .join(" ");
}

function capitalize(word: string): string {
  if (!word) return word;
  return word.charAt(0).toUpperCase() + word.slice(1);
}

export function toMatchKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "");
}
