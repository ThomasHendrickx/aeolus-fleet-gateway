from dataclasses import dataclass, field
from datetime import date

from src.sales.core.events import InvoiceIssued


class InvoiceNotPayable(Exception):
    pass


@dataclass
class Invoice:
    id: str
    order_id: str
    customer_id: str
    amount_cents: int
    status: str = "issued"
    paid_on: date | None = None
    version: int = 1
    events: list = field(default_factory=list)

    @classmethod
    def issue(cls, invoice_id: str, order) -> "Invoice":
        invoice = cls(invoice_id, order.id, order.customer_id, order.total_cents)
        invoice.events.append(InvoiceIssued(invoice.id, invoice.order_id, invoice.amount_cents))
        return invoice

    def pay(self, on: date) -> None:
        if self.status != "issued":
            raise InvoiceNotPayable(f"invoice {self.id} is {self.status}")
        self.status, self.paid_on = "paid", on

    def cancel(self) -> None:
        if self.status != "issued":
            raise InvoiceNotPayable(f"invoice {self.id} is {self.status}")
        self.status = "cancelled"
