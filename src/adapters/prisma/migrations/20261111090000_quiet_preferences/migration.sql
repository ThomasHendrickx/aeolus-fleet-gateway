-- Each person's quiet hours (preferences design): one daily window in the time zone of the device that set them.
CREATE TABLE "quiet_hours" (
    "fleet_id" TEXT NOT NULL,
    "ship_id" TEXT NOT NULL,
    "is_on" BOOLEAN NOT NULL,
    "from_minute" INTEGER NOT NULL,
    "to_minute" INTEGER NOT NULL,
    "time_zone" TEXT NOT NULL,
    "changed_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "quiet_hours_pkey" PRIMARY KEY ("fleet_id","ship_id")
);

-- The ships each person quieted or woke again (preferences design).
CREATE TABLE "quiet_ships" (
    "fleet_id" TEXT NOT NULL,
    "ship_id" TEXT NOT NULL,
    "quiet_ship_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_quiet" BOOLEAN NOT NULL,
    "changed_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "quiet_ships_pkey" PRIMARY KEY ("fleet_id","ship_id","quiet_ship_id")
);

-- A person's quiet ships, the latest quieted first, a page at a time.
CREATE INDEX "quiet_ships_listed_idx" ON "quiet_ships"("fleet_id", "ship_id", "is_quiet", "changed_at" DESC, "quiet_ship_id" DESC);
