import unittest
from datetime import date

from src.core.invoices import Invoice


class InvoiceTest(unittest.TestCase):
    def test_fields(self):
        self.assertEqual(Invoice("1", "a@b.c", date(2026, 1, 1)).id, "1")
