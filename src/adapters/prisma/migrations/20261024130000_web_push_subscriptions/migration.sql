-- Wake a person (W8): the browsers a person turned web push on in.
CREATE TABLE "web_push_subscriptions" (
    "fleet_id" TEXT NOT NULL,
    "ship_id" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "browser" TEXT NOT NULL,
    "fleet_name" TEXT NOT NULL,
    "added_at" TIMESTAMPTZ(3) NOT NULL,
    "gone_at" TIMESTAMPTZ(3),

    CONSTRAINT "web_push_subscriptions_pkey" PRIMARY KEY ("fleet_id","ship_id","endpoint")
);
