-- AlterTable
ALTER TABLE "parties" ADD COLUMN "email" TEXT,
ADD COLUMN "issuer" TEXT,
ADD COLUMN "subject" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "parties_fleet_id_email_key" ON "parties"("fleet_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "parties_fleet_id_issuer_subject_key" ON "parties"("fleet_id", "issuer", "subject");
