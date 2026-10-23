-- An outside A2A client's party is named on every call by the hash of its bearer (decision 0060).
ALTER TABLE "parties" ADD COLUMN "bearer_hash" TEXT;

CREATE UNIQUE INDEX "parties_bearer_hash_key" ON "parties"("bearer_hash");
