-- The accounts allowed as argo in each fleet, from each account's latest account token (argo's inbox, AI9).
CREATE TABLE "argo_accounts" (
    "fleet_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "person_ship_id" TEXT NOT NULL,

    CONSTRAINT "argo_accounts_pkey" PRIMARY KEY ("fleet_id","account_id")
);
