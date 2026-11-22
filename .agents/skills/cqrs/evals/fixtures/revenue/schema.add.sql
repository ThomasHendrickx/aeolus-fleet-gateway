
CREATE TABLE invoices (
    id text PRIMARY KEY,
    customer_id text NOT NULL REFERENCES customers (id),
    amount_cents integer NOT NULL CHECK (amount_cents > 0),
    issued_on date NOT NULL,
    voided boolean NOT NULL DEFAULT false
);
