-- AlterTable
ALTER TABLE "parties" ADD COLUMN     "client_id" TEXT,
ALTER COLUMN "url" DROP NOT NULL,
ALTER COLUMN "credential" DROP NOT NULL,
ALTER COLUMN "concurrency_limit" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "parties_fleet_id_client_id_key" ON "parties"("fleet_id", "client_id");
