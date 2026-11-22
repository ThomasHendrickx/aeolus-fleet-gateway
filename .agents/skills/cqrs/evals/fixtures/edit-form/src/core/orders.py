from dataclasses import dataclass, field
from datetime import date


class OrderError(Exception):
    pass


@dataclass(frozen=True)
class Address:
    street: str
    city: str
    postcode: str


@dataclass(frozen=True)
class OrderLine:
    sku: str
    quantity: int
    unit_price_cents: int

    def __post_init__(self):
        if self.quantity <= 0:
            raise OrderError("quantity must be positive")
        if self.unit_price_cents < 0:
            raise OrderError("price must not be negative")

    @property
    def total_cents(self):
        return self.quantity * self.unit_price_cents


@dataclass
class Order:
    id: str
    number: str
    customer_id: str
    placed_on: date
    shipping_address: Address
    lines: list = field(default_factory=list)
    status: str = "placed"
    note: str = ""
    version: int = 1
    customer_email: str = ""

    def __post_init__(self):
        if not self.lines:
            raise OrderError("an order needs at least one line")

    @property
    def total_cents(self):
        return sum(line.total_cents for line in self.lines)

    def to_form(self):
        return {
            "number": self.number,
            "status": self.status,
            "street": self.shipping_address.street,
            "city": self.shipping_address.city,
            "postcode": self.shipping_address.postcode,
            "note": self.note,
            "customer_email": self.customer_email,
        }

    def ship(self):
        if self.status != "placed":
            raise OrderError(f"cannot ship a {self.status} order")
        self.status = "shipped"

    def cancel(self):
        if self.status != "placed":
            raise OrderError(f"cannot cancel a {self.status} order")
        self.status = "cancelled"
