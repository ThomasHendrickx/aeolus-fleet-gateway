from dataclasses import dataclass
from datetime import date


@dataclass(frozen=True)
class Invoice:
    id: str
    customer_email: str
    due: date
    paid: bool = False
