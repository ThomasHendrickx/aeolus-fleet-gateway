from dataclasses import dataclass
from decimal import Decimal
from enum import Enum


class OrderStatus(Enum):
    NEW = "new"
    PAID = "paid"
    SHIPPED = "shipped"


@dataclass(frozen=True)
class Order:
    id: int
    total: Decimal
    status: OrderStatus
