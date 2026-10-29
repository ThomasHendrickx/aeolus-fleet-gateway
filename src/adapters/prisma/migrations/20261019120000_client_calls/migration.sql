-- CreateTable
CREATE TABLE "client_calls" (
    "fleet_id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "party" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "ship_id" TEXT NOT NULL,
    "capability" TEXT NOT NULL,
    "sent_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "client_calls_pkey" PRIMARY KEY ("fleet_id","message_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "client_calls_fleet_id_handle_key" ON "client_calls"("fleet_id", "handle");
