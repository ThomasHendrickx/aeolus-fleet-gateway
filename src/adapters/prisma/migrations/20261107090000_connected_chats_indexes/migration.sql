-- CreateIndex
CREATE INDEX "issued_tokens_fleet_id_grant_id_state_idx" ON "issued_tokens"("fleet_id", "grant_id", "state");

-- CreateIndex
CREATE INDEX "account_grants_fleet_id_person_ship_id_idx" ON "account_grants"("fleet_id", "person_ship_id");
