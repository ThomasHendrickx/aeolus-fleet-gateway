from src.web.staff_pages import customer_totals_page
from tests.support import DbTest


class CustomerTotalsPageTest(DbTest):
    def test_highest_spender_first(self):
        self.customer("ann")
        self.customer("bob")
        self.order("o1", "ann", lines=(("A", 1, 1000),))
        self.order("o2", "bob", lines=(("A", 3, 1000),))
        rows = customer_totals_page()["rows"]
        self.assertEqual([(r["customer_id"], r["orders"], r["total_cents"]) for r in rows], [("bob", 1, 3000), ("ann", 1, 1000)])
