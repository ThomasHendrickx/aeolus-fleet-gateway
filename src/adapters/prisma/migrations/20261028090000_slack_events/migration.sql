-- Gateway scopes (9.4 step 3, P-B2): a linked person's Slack message, kept by Slack's event id until core takes it; then only its id, for an hour.
CREATE TABLE "slack_events" (
    "fleet_id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "app_id" TEXT NOT NULL,
    "ship_id" TEXT NOT NULL,
    "person_ship_id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "ts" TEXT NOT NULL,
    "thread_ts" TEXT,
    "markdown" TEXT NOT NULL,
    "received_at" TIMESTAMPTZ(3) NOT NULL,
    "taken_at" TIMESTAMPTZ(3),

    CONSTRAINT "slack_events_pkey" PRIMARY KEY ("fleet_id","event_id")
);

CREATE INDEX "slack_events_taken_at_received_at_idx" ON "slack_events"("taken_at", "received_at");
