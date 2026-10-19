-- AlterTable
ALTER TABLE "authorization_codes" ADD COLUMN     "party" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "issued_tokens" ADD COLUMN     "party" TEXT NOT NULL;
