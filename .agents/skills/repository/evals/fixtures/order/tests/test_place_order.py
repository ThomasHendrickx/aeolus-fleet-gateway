import unittest
from datetime import date

from src.adapters.unit_of_work import SqliteUnitOfWork
from src.core.place_order import place_order


class PlaceOrderTest(unittest.TestCase):
    def test_places_order_with_lines(self):
        uow = SqliteUnitOfWork()
        order_id = place_order(uow, "N-1", "c1", date(2026, 1, 10), [("tea", 2, 300), ("mug", 1, 900)])
        total = uow.connection.execute("SELECT total_cents FROM orders WHERE id = ?", (order_id,)).fetchone()[0]
        lines = uow.connection.execute("SELECT COUNT(*) FROM order_lines WHERE order_id = ?", (order_id,)).fetchone()[0]
        self.assertEqual((1500, 2), (total, lines))


if __name__ == "__main__":
    unittest.main()
