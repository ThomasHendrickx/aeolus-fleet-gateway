-- CreateTable
CREATE TABLE "item_outcomes" (
    "fleet_id" TEXT NOT NULL,
    "ship_id" TEXT NOT NULL,
    "delivery_id" TEXT NOT NULL,
    "place" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "option" INTEGER,
    "at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "item_outcomes_pkey" PRIMARY KEY ("fleet_id","ship_id","delivery_id")
);
