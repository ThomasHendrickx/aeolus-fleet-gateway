-- Gateway scopes (9.5): Show everything that waits in Slack per link; an answer in a thread kept with what it answers; the fleet messages in Slack, by person ship.
ALTER TABLE "slack_links" ADD COLUMN "is_showing_all" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "slack_events" ADD COLUMN "in_reply_to" TEXT;
ALTER TABLE "slack_events" ADD COLUMN "delivery_id" TEXT;

CREATE TABLE "slack_posts" (
    "fleet_id" TEXT NOT NULL,
    "person_ship_id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "delivery_id" TEXT,
    "sender_ship_id" TEXT,
    "app_id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "ts" TEXT,
    "thread_ts" TEXT,
    "is_link_only" BOOLEAN NOT NULL,
    "acked_at" TIMESTAMPTZ(3),

    CONSTRAINT "slack_posts_pkey" PRIMARY KEY ("fleet_id","person_ship_id","message_id")
);

CREATE INDEX "slack_posts_fleet_id_app_id_channel_ts_idx" ON "slack_posts"("fleet_id", "app_id", "channel", "ts");
CREATE INDEX "slack_posts_fleet_id_app_id_channel_thread_ts_idx" ON "slack_posts"("fleet_id", "app_id", "channel", "thread_ts");

CREATE INDEX "slack_links_fleet_id_person_ship_id_idx" ON "slack_links"("fleet_id", "person_ship_id");
