from src.core.orders import OrderLine
from src.db import connect


def order_summary(order_id):
    """Summary card on the order page: number, status and total."""
    with connect() as conn:
        number, status = conn.execute("SELECT number, status FROM orders WHERE id = %s", (order_id,)).fetchone()
        lines = conn.execute("SELECT sku, quantity, unit_price_cents FROM order_lines WHERE order_id = %s", (order_id,)).fetchall()
    total = sum(OrderLine(*line).total_cents for line in lines)
    return {"number": number, "status": status, "total_cents": total}
