-- CreateTable
CREATE TABLE "oauth_clients" (
    "client_id" TEXT NOT NULL,
    "fleet_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "redirect_uris" TEXT[],
    "secret_hash" TEXT,

    CONSTRAINT "oauth_clients_pkey" PRIMARY KEY ("client_id")
);

-- CreateTable
CREATE TABLE "authorization_codes" (
    "code_hash" TEXT NOT NULL,
    "fleet_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "redirect_uri" TEXT NOT NULL,
    "code_challenge" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "scope" TEXT,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),

    CONSTRAINT "authorization_codes_pkey" PRIMARY KEY ("code_hash")
);

-- CreateTable
CREATE TABLE "issued_tokens" (
    "access_hash" TEXT NOT NULL,
    "refresh_hash" TEXT NOT NULL,
    "family_id" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "fleet_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "scope" TEXT,
    "access_expires_at" TIMESTAMPTZ(3) NOT NULL,
    "refresh_expires_at" TIMESTAMPTZ(3) NOT NULL,
    "state" TEXT NOT NULL,

    CONSTRAINT "issued_tokens_pkey" PRIMARY KEY ("access_hash")
);

-- CreateIndex
CREATE INDEX "oauth_clients_fleet_id_idx" ON "oauth_clients"("fleet_id");

-- CreateIndex
CREATE INDEX "authorization_codes_fleet_id_idx" ON "authorization_codes"("fleet_id");

-- CreateIndex
CREATE UNIQUE INDEX "issued_tokens_refresh_hash_key" ON "issued_tokens"("refresh_hash");

-- CreateIndex
CREATE INDEX "issued_tokens_fleet_id_idx" ON "issued_tokens"("fleet_id");

-- CreateIndex
CREATE INDEX "issued_tokens_family_id_idx" ON "issued_tokens"("family_id");

-- CreateIndex
CREATE INDEX "issued_tokens_code_hash_idx" ON "issued_tokens"("code_hash");
