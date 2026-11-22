import unittest
from datetime import date

from src.adapters.memory_orders import InMemoryOrders
from src.adapters.recording_notifier import RecordingNotifier
from src.core.draft_cleanup import stale_draft_numbers
from src.core.orders import Order
from src.core.reminders import send_reminders


class CallersTest(unittest.TestCase):
    def setUp(self):
        self.orders = InMemoryOrders()
        self.orders.save(Order("o1", "N-1", "c1", date(2026, 1, 5), "placed"))
        self.orders.save(Order("o2", "N-2", "c2", date(2026, 3, 5), "placed"))
        self.orders.save(Order("o3", "N-3", "c3", date(2026, 1, 6), "draft"))

    def test_reminds_the_overdue_order(self):
        notifier = RecordingNotifier()
        send_reminders(self.orders, notifier, date(2026, 2, 1))
        self.assertIn("c1", [to for to, _, _ in notifier.sent])

    def test_stale_drafts(self):
        self.assertEqual(["N-3"], stale_draft_numbers(self.orders, date(2026, 2, 1)))


if __name__ == "__main__":
    unittest.main()
