-- CreateTable
CREATE TABLE "opened_deliveries" (
    "fleet_id" TEXT NOT NULL,
    "ship_id" TEXT NOT NULL,
    "delivery_id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "sender_ship_id" TEXT NOT NULL,
    "from" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "opened_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "opened_deliveries_pkey" PRIMARY KEY ("fleet_id","ship_id","delivery_id")
);
