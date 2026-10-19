-- CreateTable
CREATE TABLE "identity_providers" (
    "fleet_id" TEXT NOT NULL,
    "issuer" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "client_secret" TEXT NOT NULL,
    "set_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "identity_providers_pkey" PRIMARY KEY ("fleet_id")
);
