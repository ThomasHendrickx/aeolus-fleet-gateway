
CREATE TABLE customer_accounts (
    customer_id text PRIMARY KEY,
    email text NOT NULL,
    paid_total_cents integer NOT NULL DEFAULT 0,
    version integer NOT NULL DEFAULT 1
);
