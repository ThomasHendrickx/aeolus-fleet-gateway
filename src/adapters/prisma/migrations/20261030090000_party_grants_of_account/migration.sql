-- Decision 0067, Q14: a disabled account's grants, read by account.
CREATE INDEX "party_grants_fleet_id_account_id_idx" ON "party_grants"("fleet_id", "account_id");
