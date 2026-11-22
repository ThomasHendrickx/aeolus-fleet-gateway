"""Delivery loop: `python3 -m src.shipping.consumers.worker` hands every new message on the topic to the handler once."""
import logging

from src.contracts import sales_invoice_events as contract
from src.db import connect
from src.infra import bus
from src.shipping.consumers import invoice_events

log = logging.getLogger(__name__)
CONSUMER = "shipping"


def run_once() -> int:
    """Deliver every message after this consumer's offset; return how many were handled."""
    with connect(autocommit=True) as conn:
        row = conn.execute("SELECT last_id FROM bus_offsets WHERE consumer = %s AND topic = %s", (CONSUMER, contract.TOPIC)).fetchone()
    offset, handled = (row[0] if row else 0), 0
    for message_id, body in bus.fetch(contract.TOPIC, offset):
        try:
            invoice_events.handle(body)
            handled += 1
        except Exception:
            log.exception("handler failed on message %s", message_id)
        offset = message_id
        with connect(autocommit=True) as conn:
            conn.execute("INSERT INTO bus_offsets (consumer, topic, last_id) VALUES (%s, %s, %s)"
                         " ON CONFLICT (consumer, topic) DO UPDATE SET last_id = EXCLUDED.last_id", (CONSUMER, contract.TOPIC, offset))
    return handled


if __name__ == "__main__":
    print(f"handled {run_once()}")
