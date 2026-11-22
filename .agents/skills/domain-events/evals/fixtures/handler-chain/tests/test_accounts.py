from datetime import date

from src import main
from tests.support import DbTest


class AccountTest(DbTest):
    def test_a_payment_credits_the_account_and_sends_a_receipt(self):
        main.open_account("ann", "ann@example.com")
        self.invoice(customer_id="ann")
        main.pay_invoice("i1", date(2026, 11, 2))
        self.assertEqual(self.rows("SELECT paid_total_cents FROM customer_accounts"), [(1000,)])
        self.assertEqual(self.rows("SELECT to_address FROM sent_mail"), [("ann@example.com",)])
