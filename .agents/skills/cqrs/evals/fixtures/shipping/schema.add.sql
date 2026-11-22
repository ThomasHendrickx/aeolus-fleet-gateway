
-- Owned by the Shipping context (src/shipping).
CREATE TABLE shipments (
    id text PRIMARY KEY,
    order_id text NOT NULL,
    status text NOT NULL DEFAULT 'pending',
    carrier text,
    dispatched_on date
);
