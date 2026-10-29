-- CreateTable
CREATE TABLE "account_grants" (
    "grant_id" TEXT NOT NULL,
    "fleet_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "person_ship_id" TEXT,
    "refresh_token" TEXT NOT NULL,
    "account_token" TEXT NOT NULL,
    "account_token_expires_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "account_grants_pkey" PRIMARY KEY ("grant_id")
);

-- CreateIndex
CREATE INDEX "account_grants_fleet_id_idx" ON "account_grants"("fleet_id");
