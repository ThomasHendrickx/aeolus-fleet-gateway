-- The messages open at argo as they are in Slack, for the person ships of accounts allowed as argo (argo's inbox, AI4).
CREATE TABLE "argo_slack_posts" (
    "fleet_id" TEXT NOT NULL,
    "person_ship_id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "app_id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "ts" TEXT,
    "is_given_up" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "argo_slack_posts_pkey" PRIMARY KEY ("fleet_id","person_ship_id","message_id")
);
