-- Gateway scopes (9.1): each fleet's Slack workspace with its configuration token, and the apps the gateway made in it.
CREATE TABLE "slack_workspaces" (
    "fleet_id" TEXT NOT NULL,
    "team_id" TEXT NOT NULL,
    "team_name" TEXT,
    "connected_by_ship_id" TEXT NOT NULL,
    "connected_by_name" TEXT NOT NULL,
    "connected_at" TIMESTAMPTZ(3) NOT NULL,
    "config_access_token" TEXT NOT NULL,
    "config_refresh_token" TEXT NOT NULL,
    "config_expires_at" TIMESTAMPTZ(3) NOT NULL,
    "is_config_refused" BOOLEAN NOT NULL,

    CONSTRAINT "slack_workspaces_pkey" PRIMARY KEY ("fleet_id")
);

CREATE TABLE "slack_apps" (
    "fleet_id" TEXT NOT NULL,
    "app_id" TEXT NOT NULL,
    "ship_id" TEXT,
    "client_id" TEXT NOT NULL,
    "client_secret" TEXT NOT NULL,
    "signing_secret" TEXT NOT NULL,
    "install_url" TEXT NOT NULL,
    "made_at" TIMESTAMPTZ(3) NOT NULL,
    "bot_token" TEXT,
    "bot_user_id" TEXT,

    CONSTRAINT "slack_apps_pkey" PRIMARY KEY ("fleet_id","app_id")
);
