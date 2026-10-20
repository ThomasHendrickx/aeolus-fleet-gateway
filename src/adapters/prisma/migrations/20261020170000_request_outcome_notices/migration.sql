-- CreateTable
CREATE TABLE "request_outcome_notices" (
    "fleet_id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "person_ship_id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "party_name" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "ended_at" TIMESTAMPTZ(3),

    CONSTRAINT "request_outcome_notices_pkey" PRIMARY KEY ("fleet_id","request_id","account_id")
);

-- CreateIndex
CREATE INDEX "request_outcome_notices_unended" ON "request_outcome_notices"("ended_at", "created_at");
