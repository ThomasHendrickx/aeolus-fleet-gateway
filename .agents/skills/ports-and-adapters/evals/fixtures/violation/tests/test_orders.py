import unittest

from src.core import orders


class OrdersTest(unittest.TestCase):
    def test_pay(self):
        self.assertTrue(orders.pay(100))
