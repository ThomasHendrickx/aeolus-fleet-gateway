from dataclasses import dataclass
from datetime import date


@dataclass
class Order:
    id: str
    number: str
    customer_id: str
    due: date
    total_cents: int
