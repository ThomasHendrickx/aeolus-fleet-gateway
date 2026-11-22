

@dataclass(frozen=True)
class InvoicePaid:
    invoice_id: str
    order_id: str
    customer_id: str
    amount_cents: int
    paid_on: object
