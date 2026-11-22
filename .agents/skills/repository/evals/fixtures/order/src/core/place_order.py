import uuid


def place_order(uow, number, customer_id, due, lines):
    """lines: list of (sku, quantity, unit_cents). Returns the new order id."""
    order_id = str(uuid.uuid4())
    total = sum(q * c for _, q, c in lines)
    with uow:
        conn = uow.connection
        conn.execute(
            "INSERT INTO orders (id, number, customer_id, due, status, total_cents) VALUES (?, ?, ?, ?, 'placed', ?)",
            (order_id, number, customer_id, due.isoformat(), total),
        )
        for position, (sku, quantity, unit_cents) in enumerate(lines):
            conn.execute(
                "INSERT INTO order_lines (order_id, position, sku, quantity, unit_cents) VALUES (?, ?, ?, ?, ?)",
                (order_id, position, sku, quantity, unit_cents),
            )
    return order_id
