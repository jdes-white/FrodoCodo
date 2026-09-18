-- Task 7A: Basiq provider adapter for CBA + Virgin (no live connection).
--
-- Adds encrypted, nullable provider-token storage to FinancialConnection,
-- per the Task 6A/7A credential threat model: if a real provider adapter
-- ever needs to hold an access/refresh token, it must never be plaintext.
-- Every existing row backfills to NULL (MockProvider never populates
-- these; no live connection exists in this codebase).
ALTER TABLE "FinancialConnection" ADD COLUMN "accessTokenEncrypted" JSONB;
ALTER TABLE "FinancialConnection" ADD COLUMN "refreshTokenEncrypted" JSONB;
ALTER TABLE "FinancialConnection" ADD COLUMN "tokenExpiresAt" TIMESTAMP(3);
