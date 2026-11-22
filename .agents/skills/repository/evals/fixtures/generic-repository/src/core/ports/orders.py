from typing import Protocol

from src.core.orders import Order


class Orders(Protocol):
    def get(self, order_id: str) -> Order | None: ...

    def save(self, order: Order) -> None: ...

    def find_by(self, where: dict) -> list[Order]:
        """where: any of status, customer_id, due_before (a date)."""
