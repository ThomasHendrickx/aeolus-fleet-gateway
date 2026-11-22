from datetime import date

from src.web.customer_pages import my_orders_page
from src.web.staff_pages import customer_panel
from tests.support import DbTest


class PagesTest(DbTest):
    def setUp(self):
        super().setUp()
        self.customer("ann")
        for day in range(1, 13):
            self.order(f"o{day:02}", "ann", placed_on=date(2026, 3, day), lines=(("A", 1, 100 * day),))

    def test_my_orders_newest_first(self):
        rows = my_orders_page("ann")["rows"]
        self.assertEqual(len(rows), 10)
        self.assertEqual(rows[0], {"number": "N-o12", "placed_on": "2026-03-12", "status": "placed", "total_cents": 1200})

    def test_customer_panel_last_five(self):
        panel = customer_panel("ann")
        self.assertEqual([o["number"] for o in panel["recent"]], ["N-o12", "N-o11", "N-o10", "N-o09", "N-o08"])
