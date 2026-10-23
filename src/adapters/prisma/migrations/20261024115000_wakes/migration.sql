-- What wakes a person (wake a person, W3, W8): the email channel they turned on, and when each channel last woke their person ship.
CREATE TABLE "email_channels" (
    "fleet_id" TEXT NOT NULL,
    "ship_id" TEXT NOT NULL,
    "turned_on_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "email_channels_pkey" PRIMARY KEY ("fleet_id","ship_id")
);

CREATE TABLE "wakes_sent" (
    "fleet_id" TEXT NOT NULL,
    "ship_id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "sent_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "wakes_sent_pkey" PRIMARY KEY ("fleet_id","ship_id","channel")
);
