-- A code and its tokens stand for a party or for a signed-in account's grant (decision 0054): exactly one of the two.
ALTER TABLE "authorization_codes" ALTER COLUMN "party" DROP NOT NULL, ADD COLUMN "grant_id" TEXT;
ALTER TABLE "authorization_codes" ADD CONSTRAINT "authorization_codes_one_holder" CHECK (("party" IS NULL) <> ("grant_id" IS NULL));
ALTER TABLE "issued_tokens" ALTER COLUMN "party" DROP NOT NULL, ADD COLUMN "grant_id" TEXT;
ALTER TABLE "issued_tokens" ADD CONSTRAINT "issued_tokens_one_holder" CHECK (("party" IS NULL) <> ("grant_id" IS NULL));
