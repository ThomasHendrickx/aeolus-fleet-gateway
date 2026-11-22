from datetime import date

from src import main
from tests.support import DbTest


class ReceiptTest(DbTest):
    def test_paying_mails_the_customer_a_receipt(self):
        self.invoice(customer_id="ann")
        main.pay_invoice("i1", date(2026, 11, 2))
        self.assertEqual(self.rows("SELECT to_address, subject FROM sent_mail"), [("ann@example.com", "Receipt for invoice i1")])
