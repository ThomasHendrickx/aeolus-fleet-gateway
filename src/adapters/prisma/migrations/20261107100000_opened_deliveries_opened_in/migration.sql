-- Where the person opened a delivery, so its row in Bridge says Seen in Bridge (aeolus-fleet#1535).
ALTER TABLE "opened_deliveries" ADD COLUMN "opened_in" TEXT;
