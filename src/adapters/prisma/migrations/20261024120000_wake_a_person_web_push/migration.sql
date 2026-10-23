-- Wake a person (W3, W6, W8): the browsers a person turned web push on in, when each channel last woke a person ship, and the pages in focus.
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

CREATE TABLE "person_wakes" (
    "fleet_id" TEXT NOT NULL,
    "ship_id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "last_woken_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "person_wakes_pkey" PRIMARY KEY ("fleet_id","ship_id","channel")
);

CREATE TABLE "focused_pages" (
    "fleet_id" TEXT NOT NULL,
    "page_id" TEXT NOT NULL,
    "ship_id" TEXT NOT NULL,
    "seen_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "focused_pages_pkey" PRIMARY KEY ("fleet_id","page_id")
);

CREATE INDEX "focused_pages_fleet_id_ship_id_seen_at_idx" ON "focused_pages"("fleet_id", "ship_id", "seen_at");
