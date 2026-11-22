import unittest

from src.adapters import rest


class RestShipTest(unittest.TestCase):
    def test_ships_paid(self):
        code, body = rest.post_ship({"order": {"status": "paid"}, "carrier": "dhl"})
        self.assertEqual((code, body["status"]), (200, "shipped"))

    def test_rejects_unpaid(self):
        code, _ = rest.post_ship({"order": {"status": "new"}, "carrier": "dhl"})
        self.assertEqual(code, 422)
