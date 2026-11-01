-- AlterTable: Slack posts and hands a delivery, never acknowledging it (Bridge, CC6).
ALTER TABLE "slack_posts" DROP COLUMN "acked_at",
DROP COLUMN "is_link_only";
