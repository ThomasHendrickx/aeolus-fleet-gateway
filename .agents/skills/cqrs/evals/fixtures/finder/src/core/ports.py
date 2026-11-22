from typing import Protocol

from src.core.customers import Customer
from src.core.orders import Order


class OrderNotFound(Exception):
    pass


class DuplicateOrderNumber(Exception):
    pass


class OrderRepository(Protocol):
    def get(self, order_id: str) -> Order: ...

    def save(self, order: Order) -> None: ...

    def find_recent_for_customer(self, customer_id: str, limit: int) -> list[Order]: ...


class CustomerRepository(Protocol):
    def get(self, customer_id: str) -> Customer: ...

    def save(self, customer: Customer) -> None: ...


class UnitOfWork(Protocol):
    orders: OrderRepository
    customers: CustomerRepository

    def __enter__(self) -> "UnitOfWork": ...

    def __exit__(self, *exc) -> None: ...
