-- Decision 0067, Q7: when a grant was last refreshed, and the indexes of the schedule that refreshes grants near their end and idle ones.
ALTER TABLE "party_grants" ADD COLUMN "refreshed_at" TIMESTAMPTZ(3);

CREATE INDEX "party_grants_access_token_ends_at_idx" ON "party_grants"("access_token_ends_at");

CREATE INDEX "party_grants_refreshed_at_signed_in_at_idx" ON "party_grants"("refreshed_at", "signed_in_at");
