-- A person's inbox lists what they opened with when it was sent. A row opened before has only when it was opened.
ALTER TABLE "opened_deliveries" ADD COLUMN "sent_at" TIMESTAMPTZ(3);
UPDATE "opened_deliveries" SET "sent_at" = "opened_at";
ALTER TABLE "opened_deliveries" ALTER COLUMN "sent_at" SET NOT NULL;
