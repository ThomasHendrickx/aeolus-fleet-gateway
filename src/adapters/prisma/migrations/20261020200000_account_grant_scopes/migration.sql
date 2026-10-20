-- The scopes a grant's account token carries: what the account may do on the gateway's pages.
ALTER TABLE "account_grants" ADD COLUMN "scopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
