import psycopg

from src.core.orders import Address, Order, OrderLine
from src.core.ports import DuplicateOrderNumber, OrderNotFound


class PgOrderRepository:
    def __init__(self, conn):
        self.conn = conn

    def get(self, order_id):
        row = self.conn.execute(
            "SELECT o.id, o.number, o.customer_id, o.placed_on, o.shipping_street, o.shipping_city, o.shipping_postcode, o.status,"
            " o.note, o.version, c.email FROM orders o JOIN customers c ON c.id = o.customer_id WHERE o.id = %s", (order_id,)).fetchone()
        if row is None:
            raise OrderNotFound(order_id)
        lines = self.conn.execute(
            "SELECT sku, quantity, unit_price_cents FROM order_lines WHERE order_id = %s ORDER BY line_no", (order_id,)).fetchall()
        return Order(row[0], row[1], row[2], row[3], Address(row[4], row[5], row[6]),
                     [OrderLine(*line) for line in lines], status=row[7], note=row[8], version=row[9], customer_email=row[10])

    def save(self, order):
        try:
            with self.conn.transaction():
                updated = self.conn.execute(
                    "UPDATE orders SET status = %s, note = %s, shipping_street = %s, shipping_city = %s, shipping_postcode = %s,"
                    " version = version + 1 WHERE id = %s AND version = %s RETURNING version",
                    (order.status, order.note, order.shipping_address.street, order.shipping_address.city,
                     order.shipping_address.postcode, order.id, order.version)).fetchone()
                if updated:
                    order.version = updated[0]
                else:
                    self.conn.execute(
                        "INSERT INTO orders (id, number, customer_id, status, placed_on, shipping_street, shipping_city, shipping_postcode, note)"
                        " VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)",
                        (order.id, order.number, order.customer_id, order.status, order.placed_on, order.shipping_address.street,
                         order.shipping_address.city, order.shipping_address.postcode, order.note))
                self.conn.execute("DELETE FROM order_lines WHERE order_id = %s", (order.id,))
                with self.conn.cursor() as cur:
                    cur.executemany(
                        "INSERT INTO order_lines (order_id, line_no, sku, quantity, unit_price_cents) VALUES (%s, %s, %s, %s, %s)",
                        [(order.id, n, l.sku, l.quantity, l.unit_price_cents) for n, l in enumerate(order.lines, 1)])
        except psycopg.errors.UniqueViolation as error:
            raise DuplicateOrderNumber(order.number) from error
