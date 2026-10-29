-- Decision 0067, Q6: the notice that told a person a call needed their sign-in to a party, one per person and party while open.
CREATE TABLE "party_sign_in_notices" (
    "fleet_id" TEXT NOT NULL,
    "party" TEXT NOT NULL,
    "person_ship_id" TEXT NOT NULL,
    "notice_id" TEXT NOT NULL,
    "is_told" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "party_sign_in_notices_pkey" PRIMARY KEY ("fleet_id","party","person_ship_id")
);
