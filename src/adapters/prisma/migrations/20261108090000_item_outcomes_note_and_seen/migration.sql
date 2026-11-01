-- The note the person sent with an outcome, and where and when they first saw the item, so Done tells its history (aeolus-fleet#1543).
ALTER TABLE "item_outcomes" ADD COLUMN "note" TEXT;
ALTER TABLE "item_outcomes" ADD COLUMN "seen_in" TEXT;
ALTER TABLE "item_outcomes" ADD COLUMN "seen_at" TIMESTAMPTZ(3);
