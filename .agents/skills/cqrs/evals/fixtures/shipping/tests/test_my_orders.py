from datetime import date

from src import main
from src.web.customer_pages import my_orders_page
from tests.support import DbTest


class MyOrdersTest(DbTest):
    def test_shows_shipping_status(self):
        self.customer("ann")
        self.order("o1", "ann", placed_on=date(2026, 3, 1))
        self.order("o2", "ann", placed_on=date(2026, 3, 2))
        main.create_shipment("s1", "o1")
        main.create_shipment("s2", "o2")
        main.dispatch_shipment("s1", "bpost", date(2026, 3, 3))
        rows = my_orders_page("ann")["rows"]
        self.assertEqual([(r["number"], r["shipping_status"], r["carrier"]) for r in rows],
                         [("N-o2", "pending", None), ("N-o1", "dispatched", "bpost")])
