from datetime import date

from src import main
from tests.support import DbTest


class FulfilmentTest(DbTest):
    def test_request_and_cancel(self):
        main.request_fulfilment("f1", "o1", date(2026, 11, 2))
        main.cancel_fulfilment("o1")
        self.assertEqual(self.rows("SELECT id, status FROM fulfilments"), [("f1", "cancelled")])
