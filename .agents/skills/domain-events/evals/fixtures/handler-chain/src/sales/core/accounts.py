from dataclasses import dataclass


@dataclass
class CustomerAccount:
    customer_id: str
    email: str
    paid_total_cents: int = 0
    version: int = 1

    def record_payment(self, amount_cents: int) -> None:
        if amount_cents <= 0:
            raise ValueError("a payment is positive")
        self.paid_total_cents += amount_cents
