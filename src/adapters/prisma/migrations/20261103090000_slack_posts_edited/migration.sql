-- AlterTable: a post in Slack is edited once something came of its item, in any place (Bridge, section 7, view sync).
ALTER TABLE "slack_posts" ADD COLUMN "edited_at" TIMESTAMPTZ(3);

-- The posts in Slack not edited yet, which the gateway's editor reads every round with what came of their item.
CREATE INDEX "slack_posts_to_edit" ON "slack_posts"("fleet_id", "person_ship_id", "delivery_id") WHERE "edited_at" IS NULL AND "delivery_id" IS NOT NULL AND "ts" IS NOT NULL;
