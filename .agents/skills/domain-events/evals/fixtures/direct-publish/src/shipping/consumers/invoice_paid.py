"""Shipping starts fulfilment when Sales announces a payment on the bus (topic sales.invoice-paid)."""
from datetime import date

from src import main
from src.infra import bus


def run_once(after_id: int = 0) -> int:
    """Handle every payment notice after `after_id`; return the last message id seen."""
    for message_id, body in bus.fetch("sales.invoice-paid", after_id):
        main.request_fulfilment(f"f-{body['order_id']}", body["order_id"], date.fromisoformat(body["paid_on"]))
        after_id = message_id
    return after_id
