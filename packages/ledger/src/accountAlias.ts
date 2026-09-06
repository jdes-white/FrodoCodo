import type { AccountType } from "@frodocodo/shared";

/**
 * Task 6B / docs/banking-data-minimisation-audit.md §5: a connected
 * account's household-facing label must be a FrodoCodo/household alias
 * (e.g. "CBA", "Virgin", "Amex"), never the provider's own account
 * nickname — a real CDR/aggregator response can embed a masked-account-
 * number fragment in that nickname (e.g. "Complete Access ...1234").
 *
 * This computes only the *default* alias offered when an account is first
 * connected, derived purely from the institution's short name and (when
 * the household already has another account at the same institution) the
 * account type — never from any provider-supplied string. The household
 * can always rename it afterward; nothing here reads from or depends on
 * provider data.
 */
export function deriveDefaultAccountAlias(
  institutionShortName: string,
  accountType: AccountType,
  existingAliasesForHousehold: readonly string[],
): string {
  const base = institutionShortName.trim();
  if (!existingAliasesForHousehold.includes(base)) return base;

  const qualified = `${base} ${accountTypeLabel(accountType)}`;
  if (!existingAliasesForHousehold.includes(qualified)) return qualified;

  // Extremely unlikely (would require two accounts of the exact same type
  // at the same institution already sharing a qualified alias) -- fall
  // back to a numbered suffix rather than silently reusing an alias.
  let n = 2;
  while (existingAliasesForHousehold.includes(`${qualified} ${n}`)) n++;
  return `${qualified} ${n}`;
}

function accountTypeLabel(accountType: AccountType): string {
  switch (accountType) {
    case "TRANSACTION":
      return "Everyday";
    case "CREDIT_CARD":
      return "Card";
    case "SAVINGS":
      return "Savings";
    default:
      return "Account";
  }
}
