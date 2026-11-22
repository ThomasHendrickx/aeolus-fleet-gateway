from dataclasses import dataclass, field
from datetime import date


@dataclass(frozen=True)
class Line:
    sku: str
    quantity: int
    unit_cents: int


@dataclass
class Order:
    id: str
    number: str
    customer_id: str
    due: date
    status: str = "placed"  # draft, placed or paid
    lines: list = field(default_factory=list)

    @property
    def total_cents(self):
        return sum(line.quantity * line.unit_cents for line in self.lines)
