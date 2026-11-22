from typing import Protocol

import miniorm

from src.core.orders import Order


class Orders(Protocol):
    def get(self, order_id: str) -> Order | None: ...

    def search(self, query: miniorm.Query) -> list[Order]: ...
