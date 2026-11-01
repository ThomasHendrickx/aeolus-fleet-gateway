-- CreateTable
CREATE TABLE "routes" (
    "fleet_id" TEXT NOT NULL,
    "ship_id" TEXT NOT NULL,
    "job" TEXT NOT NULL,
    "place" TEXT NOT NULL,
    "is_on" BOOLEAN NOT NULL,
    "changed_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "routes_pkey" PRIMARY KEY ("fleet_id","ship_id","job","place")
);
