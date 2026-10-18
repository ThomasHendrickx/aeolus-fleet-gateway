-- CreateTable
CREATE TABLE "calls" (
    "delivery_id" TEXT NOT NULL,
    "fleet_id" TEXT NOT NULL,
    "party" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "reply" JSONB,

    CONSTRAINT "calls_pkey" PRIMARY KEY ("delivery_id")
);

-- CreateIndex
CREATE INDEX "calls_fleet_id_idx" ON "calls"("fleet_id");
