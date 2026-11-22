from dataclasses import dataclass, field

from src.sales.core.events import OrderPlaced


@dataclass(frozen=True)
class OrderLine:
    sku: str
    quantity: int
    unit_price_cents: int

    def __post_init__(self):
        if self.quantity <= 0 or self.unit_price_cents < 0:
            raise ValueError("a line needs a positive quantity and a non-negative price")

    @property
    def total_cents(self) -> int:
        return self.quantity * self.unit_price_cents


@dataclass
class Order:
    id: str
    customer_id: str
    lines: list
    status: str = "placed"
    version: int = 1
    events: list = field(default_factory=list)

    @classmethod
    def place(cls, order_id: str, customer_id: str, lines: list) -> "Order":
        if not lines:
            raise ValueError("an order needs at least one line")
        order = cls(order_id, customer_id, list(lines))
        order.events.append(OrderPlaced(order.id, order.customer_id, order.total_cents))
        return order

    @property
    def total_cents(self) -> int:
        return sum(line.total_cents for line in self.lines)
