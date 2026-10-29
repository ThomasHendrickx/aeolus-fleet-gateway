-- Gateway scopes (9.2): a Slack app's bot name, its install opened from the gateway, and its removal in Slack; an app id names one app across fleets.
ALTER TABLE "slack_apps" ADD COLUMN "name" TEXT NOT NULL DEFAULT '';
ALTER TABLE "slack_apps" ALTER COLUMN "name" DROP DEFAULT;
ALTER TABLE "slack_apps" ADD COLUMN "install_started_at" TIMESTAMPTZ(3);
ALTER TABLE "slack_apps" ADD COLUMN "removed_in_slack_at" TIMESTAMPTZ(3);
CREATE UNIQUE INDEX "slack_apps_app_id_key" ON "slack_apps"("app_id");
