from src.infra import bus
from src.shipping.consumers import worker
from tests.support import DbTest

PAID = {"event_id": "e1", "type": "InvoicePaid", "invoice_id": "i1", "order_id": "o1", "invoice_version": 2, "occurred_on": "2026-11-02"}
REFUNDED = {"event_id": "e2", "type": "InvoiceRefunded", "invoice_id": "i1", "order_id": "o1", "invoice_version": 3, "occurred_on": "2026-11-04"}


class InvoiceConsumerTest(DbTest):
    def test_payment_requests_fulfilment(self):
        bus.publish("sales.invoices.v1", PAID)
        worker.run_once()
        self.assertEqual(self.rows("SELECT order_id, status FROM fulfilments"), [("o1", "requested")])

    def test_refund_after_payment_cancels_it(self):
        bus.publish("sales.invoices.v1", PAID)
        bus.publish("sales.invoices.v1", REFUNDED)
        worker.run_once()
        self.assertEqual(self.rows("SELECT order_id, status FROM fulfilments"), [("o1", "cancelled")])
