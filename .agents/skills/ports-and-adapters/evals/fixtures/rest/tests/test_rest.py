import unittest

from src.adapters import rest


class PriceTest(unittest.TestCase):
    def test_big_order_discount(self):
        code, body = rest.post_price({"items": [{"cents": 10000, "qty": 1}]})
        self.assertEqual((code, body["total_cents"]), (200, 9000))

    def test_vip_coupon_stacks(self):
        code, body = rest.post_price({"items": [{"cents": 10000, "qty": 1}], "coupon": "VIP1"})
        self.assertEqual(body["total_cents"], 8500)

    def test_negative_total(self):
        code, _ = rest.post_price({"items": [{"cents": -5, "qty": 1}]})
        self.assertEqual(code, 422)
