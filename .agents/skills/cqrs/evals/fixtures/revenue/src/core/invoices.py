from dataclasses import dataclass
from datetime import date


class InvoiceError(Exception):
    pass


@dataclass
class Invoice:
    id: str
    customer_id: str
    amount_cents: int
    issued_on: date
    voided: bool = False

    def __post_init__(self):
        if self.amount_cents <= 0:
            raise InvoiceError("an invoice amount must be positive")

    def void(self):
        if self.voided:
            raise InvoiceError("invoice already voided")
        self.voided = True
