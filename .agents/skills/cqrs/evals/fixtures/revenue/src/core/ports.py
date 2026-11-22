from typing import Protocol

from src.core.customers import Customer
from src.core.invoices import Invoice
from src.core.orders import Order


class OrderNotFound(Exception):
    pass


class DuplicateOrderNumber(Exception):
    pass


class OrderRepository(Protocol):
    def get(self, order_id: str) -> Order: ...

    def save(self, order: Order) -> None: ...


class CustomerRepository(Protocol):
    def get(self, customer_id: str) -> Customer: ...

    def save(self, customer: Customer) -> None: ...


class InvoiceRepository(Protocol):
    def get(self, invoice_id: str) -> Invoice: ...

    def add(self, invoice: Invoice) -> None: ...

    def save(self, invoice: Invoice) -> None: ...


class UnitOfWork(Protocol):
    orders: OrderRepository
    customers: CustomerRepository
    invoices: InvoiceRepository

    def __enter__(self) -> "UnitOfWork": ...

    def __exit__(self, *exc) -> None: ...
