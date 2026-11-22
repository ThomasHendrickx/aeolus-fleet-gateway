import unittest
from datetime import date

from src import main
from src.core.orders import Address
from src.db import reset_schema

HOME = Address("1 Main St", "Ghent", "9000")


class DbTest(unittest.TestCase):
    def setUp(self):
        reset_schema()

    def customer(self, cid, name=None, created_on=date(2026, 1, 1)):
        return main.register_customer(cid, name or cid.title(), f"{cid}@example.com", created_on)

    def order(self, oid, customer_id, lines=(("SKU-1", 1, 1000),), placed_on=date(2026, 3, 1), number=None):
        return main.place_order(oid, number or f"N-{oid}", customer_id, placed_on, HOME,
                                [{"sku": s, "quantity": q, "unit_price_cents": p} for s, q, p in lines])
