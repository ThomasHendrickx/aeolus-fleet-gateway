-- CreateTable
CREATE TABLE "sign_ins" (
    "state_hash" TEXT NOT NULL,
    "fleet_id" TEXT NOT NULL,
    "request" JSONB NOT NULL,
    "verifier" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sign_ins_pkey" PRIMARY KEY ("state_hash")
);

-- CreateIndex
CREATE INDEX "sign_ins_fleet_id_idx" ON "sign_ins"("fleet_id");
