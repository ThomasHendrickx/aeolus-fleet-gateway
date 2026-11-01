-- AlterTable
ALTER TABLE "basket_entries" ADD COLUMN "is_unanswered" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "stored_at" TIMESTAMPTZ(3);
