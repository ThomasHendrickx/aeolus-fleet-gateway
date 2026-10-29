-- Decision 0067: a person's grant of an outside MCP server where each person signs in, one per person and party, and one per outside account and party where the server named it.
CREATE TABLE "party_grants" (
    "fleet_id" TEXT NOT NULL,
    "party" TEXT NOT NULL,
    "person_ship_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "subject" TEXT,
    "outside_account_name" TEXT,
    "access_token" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token_ends_at" TIMESTAMPTZ(3),
    "signed_in_at" TIMESTAMPTZ(3) NOT NULL,
    "last_used_at" TIMESTAMPTZ(3),

    CONSTRAINT "party_grants_pkey" PRIMARY KEY ("fleet_id","party","person_ship_id")
);

CREATE UNIQUE INDEX "party_grants_fleet_id_party_subject_key" ON "party_grants"("fleet_id", "party", "subject");
