import unittest
from datetime import date

from src.adapters import cron_refunds


class CronRefundsTest(unittest.TestCase):
    def test_settles_each_request(self):
        request = {"amount_cents": 100, "paid_cents": 500, "paid_on": date(2026, 1, 1)}
        results = cron_refunds.settle([request, request], date(2026, 1, 2))
        self.assertEqual([code for code, _ in results], [200, 200])
