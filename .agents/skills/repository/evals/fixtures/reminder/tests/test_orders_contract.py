import sqlite3
import unittest
from datetime import date

from src.adapters import schema
from src.adapters.memory_orders import InMemoryOrders
from src.adapters.sqlite_orders import SqliteOrders
from src.core.errors import DuplicateOrderNumber
from src.core.orders import Line, Order


def make(order_id, number, customer, due, status="placed", lines=()):
    return Order(order_id, number, customer, due, status, list(lines))


class OrdersContract:
    """Runs against every adapter."""

    def test_save_then_get(self):
        self.repo.save(make("o1", "N-1", "c1", date(2026, 1, 5), lines=[Line("tea", 2, 300)]))
        got = self.repo.get("o1")
        self.assertEqual(("N-1", 600), (got.number, got.total_cents))

    def test_get_missing_is_none(self):
        self.assertIsNone(self.repo.get("nope"))

    def test_duplicate_number_is_rejected(self):
        self.repo.save(make("o1", "N-1", "c1", date(2026, 1, 5)))
        with self.assertRaises(DuplicateOrderNumber):
            self.repo.save(make("o2", "N-1", "c2", date(2026, 1, 6)))

    def test_save_again_replaces_lines(self):
        self.repo.save(make("o1", "N-1", "c1", date(2026, 1, 5), lines=[Line("tea", 2, 300)]))
        self.repo.save(make("o1", "N-1", "c1", date(2026, 1, 5), lines=[Line("mug", 1, 900)]))
        self.assertEqual(900, self.repo.get("o1").total_cents)

    def test_list_for_customer_orders_by_due_then_number(self):
        self.repo.save(make("o1", "N-2", "c1", date(2026, 1, 5)))
        self.repo.save(make("o2", "N-1", "c1", date(2026, 1, 5)))
        self.repo.save(make("o3", "N-3", "c2", date(2026, 1, 1)))
        self.assertEqual(["N-1", "N-2"], [o.number for o in self.repo.list_for_customer("c1")])


class InMemoryOrdersContract(OrdersContract, unittest.TestCase):
    def setUp(self):
        self.repo = InMemoryOrders()


class SqliteOrdersContract(OrdersContract, unittest.TestCase):
    def setUp(self):
        self.repo = SqliteOrders(schema.connect())


if __name__ == "__main__":
    unittest.main()
