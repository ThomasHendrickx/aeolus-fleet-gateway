from dataclasses import dataclass
from datetime import date

from src.db import connect


@dataclass(frozen=True)
class MyOrderRow:
    number: str
    placed_on: date
    status: str
    total_cents: int
    shipping_status: str
    carrier: str | None
    dispatched_on: date | None


SQL = """
SELECT o.number, o.placed_on, o.status,
       (SELECT sum(l.quantity * l.unit_price_cents) FROM order_lines l WHERE l.order_id = o.id) AS total_cents,
       coalesce(s.status, 'pending'), s.carrier, s.dispatched_on
FROM orders o
LEFT JOIN shipments s ON s.order_id = o.id
WHERE o.customer_id = %(customer_id)s
ORDER BY o.placed_on DESC, o.number DESC
LIMIT %(limit)s OFFSET %(offset)s
"""


def my_orders(customer_id: str, page: int, page_size: int) -> list:
    with connect() as conn:
        rows = conn.execute(SQL, {"customer_id": customer_id, "limit": page_size, "offset": (page - 1) * page_size}).fetchall()
    return [MyOrderRow(*row) for row in rows]
