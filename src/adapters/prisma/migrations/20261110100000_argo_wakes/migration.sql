-- The messages to argo a wake or a page in focus covered for each person ship allowed as argo (argo's inbox, AI5).
CREATE TABLE "argo_messages_covered" (
    "fleet_id" TEXT NOT NULL,
    "ship_id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,

    CONSTRAINT "argo_messages_covered_pkey" PRIMARY KEY ("fleet_id","ship_id","message_id")
);

-- When each channel last woke each person ship for what waits at argo, apart from its own wakes (argo's inbox, AI5).
CREATE TABLE "argo_wakes_sent" (
    "fleet_id" TEXT NOT NULL,
    "ship_id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "sent_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "argo_wakes_sent_pkey" PRIMARY KEY ("fleet_id","ship_id","channel")
);
