-- CreateTable
CREATE TABLE "pending_requests" (
    "fleet_id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "subject_key" TEXT NOT NULL,
    "client_id" TEXT,
    "client_name" TEXT,
    "url" TEXT,
    "requesters" JSONB NOT NULL,
    "asked_at" TIMESTAMPTZ(3) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "state" TEXT NOT NULL,
    "decided_by" JSONB,
    "decided_at" TIMESTAMPTZ(3),

    CONSTRAINT "pending_requests_pkey" PRIMARY KEY ("fleet_id","request_id"),
    CONSTRAINT "pending_requests_kind_check" CHECK ("kind" IN ('client', 'server')),
    CONSTRAINT "pending_requests_state_check" CHECK ("state" IN ('pending', 'approving', 'approved', 'denied', 'expired'))
);

-- One open request per client or server in a fleet: a second requester joins it (decision 0056).
CREATE UNIQUE INDEX "pending_requests_one_open" ON "pending_requests" ("fleet_id", "subject_key") WHERE "state" IN ('pending', 'approving');

-- The open requests of a fleet, the oldest first.
CREATE INDEX "pending_requests_fleet_asked" ON "pending_requests" ("fleet_id", "asked_at");
