-- CreateTable
CREATE TABLE "parties" (
    "fleet_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "credential" JSONB NOT NULL,
    "owner_ship_id" TEXT NOT NULL,
    "concurrency_limit" INTEGER NOT NULL,
    "state" TEXT NOT NULL,
    "proxy_ship_id" TEXT,
    "secret" TEXT,
    "crew_token" TEXT,
    "request_id" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "approved_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "parties_pkey" PRIMARY KEY ("fleet_id","name")
);
