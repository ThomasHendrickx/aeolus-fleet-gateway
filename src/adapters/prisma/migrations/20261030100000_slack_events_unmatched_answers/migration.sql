-- Gateway scopes 9.5 step 4: an answer in a thread through the gateway's own bot, kept before the delivery it answers is in Slack, goes to no ship until it is matched.
ALTER TABLE "slack_events" ALTER COLUMN "ship_id" DROP NOT NULL;
