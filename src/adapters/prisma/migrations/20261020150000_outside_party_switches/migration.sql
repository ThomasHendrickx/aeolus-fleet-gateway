-- CreateTable
CREATE TABLE "outside_party_switches" (
    "fleet_id" TEXT NOT NULL,
    "is_on" BOOLEAN NOT NULL,
    "changed_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "outside_party_switches_pkey" PRIMARY KEY ("fleet_id")
);
