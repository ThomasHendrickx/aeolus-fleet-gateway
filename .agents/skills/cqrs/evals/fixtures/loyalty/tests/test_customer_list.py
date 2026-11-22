from src import main
from src.web.staff_pages import customer_list
from tests.support import DbTest


class CustomerListTest(DbTest):
    def test_gold_after_ten_orders_unless_suspended(self):
        for cid in ("ann", "bob", "cy"):
            self.customer(cid)
            for n in range(11):
                self.order(f"{cid}{n}", cid)
        main.suspend_customer("bob")
        main.cancel_order("cy0")
        tiers = {r["customer_id"]: r["tier"] for r in customer_list()["rows"]}
        self.assertEqual(tiers, {"ann": "gold", "bob": "standard", "cy": "standard"})
