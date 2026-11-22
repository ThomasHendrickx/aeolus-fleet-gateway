from datetime import date

from src import main
from src.shipping.consumers import invoice_paid
from tests.support import DbTest


class PaymentNoticeTest(DbTest):
    def test_a_payment_starts_fulfilment(self):
        self.invoice()
        main.pay_invoice("i1", date(2026, 11, 2))
        invoice_paid.run_once()
        self.assertEqual(self.rows("SELECT order_id, status FROM fulfilments"), [("o1", "requested")])
