-- AlterTable
ALTER TABLE "pending_requests" ADD COLUMN "told_account_ids" JSONB NOT NULL DEFAULT '[]';
