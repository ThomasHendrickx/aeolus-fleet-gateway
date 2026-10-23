-- A client party with no human at the authorize step signs in by client credentials (vendor platforms V4): an access token from no code, with no refresh token.
ALTER TABLE "oauth_clients" ADD COLUMN "grant" TEXT NOT NULL DEFAULT 'authorizationCode';
ALTER TABLE "issued_tokens" ALTER COLUMN "refresh_hash" DROP NOT NULL;
ALTER TABLE "issued_tokens" ALTER COLUMN "refresh_expires_at" DROP NOT NULL;
ALTER TABLE "issued_tokens" ALTER COLUMN "code_hash" DROP NOT NULL;
