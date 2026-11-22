CREATE TABLE customers (
    id text PRIMARY KEY,
    name text NOT NULL,
    email text NOT NULL,
    created_on date NOT NULL
);

CREATE TABLE orders (
    id text PRIMARY KEY,
    number text NOT NULL UNIQUE,
    customer_id text NOT NULL REFERENCES customers (id),
    status text NOT NULL,
    placed_on date NOT NULL,
    shipping_street text NOT NULL,
    shipping_city text NOT NULL,
    shipping_postcode text NOT NULL,
    note text NOT NULL DEFAULT '',
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
