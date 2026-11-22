import sqlite3
from datetime import date

import miniorm

from src.core.orders import Order


def _order(row):
    return Order(row[0], row[1], row[2], date.fromisoformat(row[3]), row[4])


class SqliteOrders:
    def __init__(self, conn: sqlite3.Connection):
        self.conn = conn

    def get(self, order_id):
        row = self.conn.execute("SELECT id, number, customer_id, due, total_cents FROM orders WHERE id = ?", (order_id,)).fetchone()
        return _order(row) if row else None

    def search(self, query: miniorm.Query):
        sql, args = query.sql()
        rows = self.conn.execute(sql.replace("SELECT *", "SELECT id, number, customer_id, due, total_cents"), args).fetchall()
        return [_order(r) for r in rows]
