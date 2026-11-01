-- CreateTable
CREATE TABLE "basket_entries" (
    "fleet_id" TEXT NOT NULL,
    "ship_id" TEXT NOT NULL,
    "question_id" TEXT NOT NULL,
    "delivery_id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "sender_ship_id" TEXT NOT NULL,
    "from" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "sent_at" TIMESTAMPTZ(3) NOT NULL,
    "option" INTEGER NOT NULL,
    "note" TEXT,
    "added_at" TIMESTAMPTZ(3) NOT NULL,
    "state" TEXT NOT NULL,
    "refusal" TEXT,

    CONSTRAINT "basket_entries_pkey" PRIMARY KEY ("fleet_id","ship_id","question_id")
);

-- CreateIndex
CREATE INDEX "basket_entries_fleet_id_ship_id_added_at_idx" ON "basket_entries"("fleet_id", "ship_id", "added_at");

-- The person ships with an entry stored as sending, which the gateway's sender reads every round.
CREATE INDEX "basket_entries_sending" ON "basket_entries"("fleet_id", "ship_id") WHERE "state" = 'sending';
