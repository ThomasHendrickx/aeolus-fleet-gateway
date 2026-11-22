from typing import Protocol

from src.core.orders import Order


class Orders(Protocol):
    def get(self, order_id: str) -> Order | None: ...

    def save(self, order: Order) -> None: ...

    def list_for_customer(self, customer_id: str) -> list[Order]: ...
