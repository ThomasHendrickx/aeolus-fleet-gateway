-- Wake a person (W6): a person's pages in focus, on any gateway instance.
CREATE TABLE "focused_pages" (
    "fleet_id" TEXT NOT NULL,
    "page_id" TEXT NOT NULL,
    "ship_id" TEXT NOT NULL,
    "seen_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "focused_pages_pkey" PRIMARY KEY ("fleet_id","page_id")
);

CREATE INDEX "focused_pages_fleet_id_ship_id_seen_at_idx" ON "focused_pages"("fleet_id", "ship_id", "seen_at");
