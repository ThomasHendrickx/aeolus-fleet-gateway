import unittest

from src import main
from src.db import connect, reset_schema


class DbTest(unittest.TestCase):
    def setUp(self):
        reset_schema()

    def invoice(self, invoice_id="i1", order_id="o1", customer_id="ann", lines=(("A", 2, 500),)):
        if not self.rows("SELECT 1 FROM customer_accounts WHERE customer_id = %s", customer_id):
            main.open_account(customer_id, f"{customer_id}@example.com")
        main.place_order(order_id, customer_id, [{"sku": s, "quantity": q, "unit_price_cents": p} for s, q, p in lines])
        return main.issue_invoice(invoice_id, order_id)

    def rows(self, sql, *args):
        with connect() as conn:
            return conn.execute(sql, args).fetchall()
