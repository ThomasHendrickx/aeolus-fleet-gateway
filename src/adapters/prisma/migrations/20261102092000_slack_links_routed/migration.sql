-- AlterTable: what shows in Slack is routed per job (Bridge, section 8), no longer one switch per link (B5).
ALTER TABLE "slack_links" DROP COLUMN "is_showing_all";
