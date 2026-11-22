"""Sales domain events (see docs/event-list.md). Aggregates record them in `events`."""
from dataclasses import dataclass


@dataclass(frozen=True)
class OrderPlaced:
    order_id: str
    customer_id: str
    total_cents: int


@dataclass(frozen=True)
class InvoiceIssued:
    invoice_id: str
    order_id: str
    amount_cents: int
