-- Gateway scopes (9.3): a person's Slack account linked to their account in a fleet, one Slack user to one account and one Slack user per account in each fleet.
CREATE TABLE "slack_links" (
    "fleet_id" TEXT NOT NULL,
    "team_id" TEXT NOT NULL,
    "slack_user_id" TEXT NOT NULL,
    "slack_name" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "person_ship_id" TEXT NOT NULL,
    "linked_at" TIMESTAMPTZ(3) NOT NULL,
    "stopped_at" TIMESTAMPTZ(3),

    CONSTRAINT "slack_links_pkey" PRIMARY KEY ("fleet_id","team_id","slack_user_id")
);

CREATE UNIQUE INDEX "slack_links_fleet_id_account_id_key" ON "slack_links"("fleet_id", "account_id");
