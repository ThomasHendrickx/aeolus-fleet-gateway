from datetime import date

from src import main
from src.sales.core.invoices import InvoiceNotPayable
from tests.support import DbTest


class InvoiceTest(DbTest):
    def test_invoice_is_issued_for_the_order_total(self):
        self.invoice(lines=(("A", 2, 500), ("B", 1, 250)))
        self.assertEqual(self.rows("SELECT amount_cents, status FROM invoices"), [(1250, "issued")])

    def test_paying_records_the_date_and_bumps_the_version(self):
        self.invoice()
        version = main.pay_invoice("i1", date(2026, 11, 2))
        self.assertEqual(version, 2)
        self.assertEqual(self.rows("SELECT status, paid_on FROM invoices"), [("paid", date(2026, 11, 2))])

    def test_a_paid_invoice_cannot_be_paid_again(self):
        self.invoice()
        main.pay_invoice("i1", date(2026, 11, 2))
        with self.assertRaises(InvoiceNotPayable):
            main.pay_invoice("i1", date(2026, 11, 3))

    def test_cancelling(self):
        self.invoice()
        main.cancel_invoice("i1")
        self.assertEqual(self.rows("SELECT status FROM invoices"), [("cancelled",)])
