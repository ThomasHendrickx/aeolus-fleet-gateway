import unittest

from src.adapters import rest_invoices, rest_users


class OtherHandlersTest(unittest.TestCase):
    def test_user(self):
        self.assertEqual(rest_users.post_user({"email": "A@b.c", "name": "Al"})[0], 201)

    def test_invoice(self):
        self.assertEqual(rest_invoices.post_invoice({"lines": [{"cents": 100}]})[1]["total_cents"], 121)
