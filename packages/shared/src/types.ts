// Framework/DB-independent enums mirrored from the Prisma schema, used by
// pure packages (domain, ledger, providers, ai) that must not depend on
// @frodocodo/db so they stay unit-testable in isolation.

export type AccountType = "TRANSACTION" | "CREDIT_CARD" | "SAVINGS" | "OTHER";

export type ConnectionMethod = "CDR" | "CREDENTIAL_BASED" | "MANUAL";

export type ConsentStatus = "PENDING" | "ACTIVE" | "EXPIRING" | "EXPIRED" | "REVOKED";

export type TransactionDirection = "DEBIT" | "CREDIT";

export type TransactionStatus = "PENDING" | "POSTED";

export type ClassificationSource = "RULE" | "LEARNED_MAPPING" | "PROVIDER" | "AI" | "USER" | "SYSTEM";

export type SpendingType = "FIXED_COMMITMENT" | "FLEXIBLE" | "SAVINGS";

export type BudgetPeriodType = "CALENDAR_MONTH" | "ANCHORED_MONTHLY" | "FORTNIGHTLY" | "CUSTOM";

export type PacingStatus = "AHEAD" | "ON_TRACK" | "BEHIND";
