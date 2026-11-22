-- Sales context
CREATE TABLE orders (
    id text PRIMARY KEY,
    customer_id text NOT NULL,
    status text NOT NULL,
    version integer NOT NULL DEFAULT 1
);

CREATE TABLE order_lines (
    order_id text NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
    line_no integer NOT NULL,
    sku text NOT NULL,
    quantity integer NOT NULL CHECK (quantity > 0),
    unit_price_cents integer NOT NULL CHECK (unit_price_cents >= 0),
    PRIMARY KEY (order_id, line_no)
);

CREATE TABLE invoices (
    id text PRIMARY KEY,
    order_id text NOT NULL REFERENCES orders (id),
    customer_id text NOT NULL,
    amount_cents integer NOT NULL,
    status text NOT NULL,
    paid_on date,
    version integer NOT NULL DEFAULT 1
);

-- Shipping context
CREATE TABLE fulfilments (
    id text PRIMARY KEY,
    order_id text NOT NULL,
    status text NOT NULL,
    requested_on date NOT NULL
);

-- The message broker's own store. Only src/infra/bus.py writes it, on its own connection.
CREATE TABLE bus_messages (
    id bigserial PRIMARY KEY,
    topic text NOT NULL,
    body jsonb NOT NULL,
    published_at timestamptz NOT NULL DEFAULT now()
);

-- The mail server's outbox stand-in. Only src/infra/mail.py writes it, on its own connection.
CREATE TABLE sent_mail (
    id bigserial PRIMARY KEY,
    to_address text NOT NULL,
    subject text NOT NULL,
    body text NOT NULL,
    sent_at timestamptz NOT NULL DEFAULT now()
);
