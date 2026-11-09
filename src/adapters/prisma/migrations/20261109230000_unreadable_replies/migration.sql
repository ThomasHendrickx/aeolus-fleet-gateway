CREATE TABLE "unreadable_replies" (
    "fleet_id" TEXT NOT NULL,
    "ship_id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    CONSTRAINT "unreadable_replies_pkey" PRIMARY KEY ("fleet_id", "ship_id", "message_id")
);
