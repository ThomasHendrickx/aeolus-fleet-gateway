CREATE TABLE "meeting_contributions" (
    "fleet_id" TEXT NOT NULL,
    "ship_id" TEXT NOT NULL,
    "meeting_id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "is_seen" BOOLEAN NOT NULL,
    CONSTRAINT "meeting_contributions_pkey" PRIMARY KEY ("fleet_id", "ship_id", "meeting_id", "message_id")
);
CREATE INDEX "meeting_contributions_fleet_id_ship_id_is_seen_meeting_id_idx"
    ON "meeting_contributions"("fleet_id", "ship_id", "is_seen", "meeting_id");
