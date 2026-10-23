-- The gateway's messages to outside A2A agents, by delivery, and which task each reply tells of (slice 6).
CREATE TABLE "a2a_agent_calls" (
    "delivery_id" TEXT NOT NULL,
    "fleet_id" TEXT NOT NULL,
    "party" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "sender_ship_id" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "task_id" TEXT,
    "context_id" TEXT,
    "deadline_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "a2a_agent_calls_pkey" PRIMARY KEY ("fleet_id", "delivery_id")
);

CREATE INDEX "a2a_agent_calls_fleet_id_party_state_idx" ON "a2a_agent_calls"("fleet_id", "party", "state");

CREATE TABLE "a2a_agent_replies" (
    "fleet_id" TEXT NOT NULL,
    "party" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "context_id" TEXT NOT NULL,

    CONSTRAINT "a2a_agent_replies_pkey" PRIMARY KEY ("fleet_id", "party", "message_id")
);
