import sqlite3
from datetime import date

from src.core.errors import DuplicateOrderNumber
from src.core.orders import Line, Order


class SqliteOrders:
    """Joins the caller's connection; the caller commits."""

    def __init__(self, conn: sqlite3.Connection):
        self.conn = conn

    def get(self, order_id):
        row = self.conn.execute("SELECT id, number, customer_id, due, status FROM orders WHERE id = ?", (order_id,)).fetchone()
        if row is None:
            return None
        lines = self.conn.execute(
            "SELECT sku, quantity, unit_cents FROM order_lines WHERE order_id = ? ORDER BY position", (order_id,)
        ).fetchall()
        return Order(row[0], row[1], row[2], date.fromisoformat(row[3]), row[4], [Line(*r) for r in lines])

    def save(self, order):
        try:
            self.conn.execute(
                "INSERT INTO orders (id, number, customer_id, due, status, total_cents) VALUES (?, ?, ?, ?, ?, ?) "
                "ON CONFLICT(id) DO UPDATE SET number = excluded.number, customer_id = excluded.customer_id, "
                "due = excluded.due, status = excluded.status, total_cents = excluded.total_cents",
                (order.id, order.number, order.customer_id, order.due.isoformat(), order.status, order.total_cents),
            )
        except sqlite3.IntegrityError as error:
            raise DuplicateOrderNumber(order.number) from error
        self.conn.execute("DELETE FROM order_lines WHERE order_id = ?", (order.id,))
        for position, line in enumerate(order.lines):
            self.conn.execute(
                "INSERT INTO order_lines (order_id, position, sku, quantity, unit_cents) VALUES (?, ?, ?, ?, ?)",
                (order.id, position, line.sku, line.quantity, line.unit_cents),
            )

    def list_for_customer(self, customer_id):
        rows = self.conn.execute("SELECT id FROM orders WHERE customer_id = ? ORDER BY due, number", (customer_id,)).fetchall()
        return [self.get(row[0]) for row in rows]
