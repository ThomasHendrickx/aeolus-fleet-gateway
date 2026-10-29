-- CreateTable
CREATE TABLE "person_crews" (
    "fleet_id" TEXT NOT NULL,
    "ship_id" TEXT NOT NULL,
    "crew_token" TEXT NOT NULL,
    "crewed_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "person_crews_pkey" PRIMARY KEY ("fleet_id","ship_id")
);
