-- AlterTable
ALTER TABLE "client_calls" ADD COLUMN "output_content_type" TEXT,
ADD COLUMN "deadline_at" TIMESTAMP(3) NOT NULL;

-- CreateTable
CREATE TABLE "client_call_replies" (
    "delivery_id" TEXT NOT NULL,
    "fleet_id" TEXT NOT NULL,
    "call_message_id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL,
    "sequence" SERIAL NOT NULL,

    CONSTRAINT "client_call_replies_pkey" PRIMARY KEY ("delivery_id")
);

-- CreateIndex
CREATE INDEX "client_call_replies_fleet_id_call_message_id_idx" ON "client_call_replies"("fleet_id", "call_message_id");
