import sqlite3

SCHEMA = """
CREATE TABLE orders (
    id TEXT PRIMARY KEY,
    number TEXT NOT NULL UNIQUE,
    customer_id TEXT NOT NULL,
    due TEXT NOT NULL,
    status TEXT NOT NULL,
    total_cents INTEGER NOT NULL
);
CREATE TABLE order_lines (
    order_id TEXT NOT NULL REFERENCES orders(id),
    position INTEGER NOT NULL,
    sku TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    unit_cents INTEGER NOT NULL,
    PRIMARY KEY (order_id, position)
);
"""


def connect(path=":memory:"):
    conn = sqlite3.connect(path)
    conn.executescript(SCHEMA)
    return conn
