import sqlite3
import unittest

import miniorm
from src.adapters.sqlite_orders import SqliteOrders


class SqliteOrdersTest(unittest.TestCase):
    def setUp(self):
        self.conn = sqlite3.connect(":memory:")
        self.conn.execute("CREATE TABLE orders (id TEXT PRIMARY KEY, number TEXT, customer_id TEXT, due TEXT, total_cents INTEGER)")
        self.conn.execute("INSERT INTO orders VALUES ('o1', 'N-1', 'c1', '2026-01-10', 500)")
        self.orders = SqliteOrders(self.conn)

    def test_get(self):
        self.assertEqual("N-1", self.orders.get("o1").number)

    def test_search_by_customer(self):
        found = self.orders.search(miniorm.Query("orders").where(customer_id="c1"))
        self.assertEqual(["o1"], [o.id for o in found])


if __name__ == "__main__":
    unittest.main()
