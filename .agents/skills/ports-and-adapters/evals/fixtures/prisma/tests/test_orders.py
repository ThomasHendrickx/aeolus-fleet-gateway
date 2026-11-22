import unittest
from decimal import Decimal

from src.core.orders import Order, OrderStatus


class OrderTest(unittest.TestCase):
    def test_fields(self):
        self.assertEqual(Order(1, Decimal("1.50"), OrderStatus.NEW).total, Decimal("1.50"))
