from typing import Protocol

from src.sales.core.invoices import Invoice
from src.sales.core.orders import Order


class NotFound(Exception):
    pass


class OrderRepository(Protocol):
    def get(self, order_id: str) -> Order: ...

    def add(self, order: Order) -> None: ...


class InvoiceRepository(Protocol):
    def get(self, invoice_id: str) -> Invoice: ...

    def add(self, invoice: Invoice) -> None: ...

    def save(self, invoice: Invoice) -> None: ...


class SalesUnitOfWork(Protocol):
    orders: OrderRepository
    invoices: InvoiceRepository

    def __enter__(self) -> "SalesUnitOfWork": ...

    def __exit__(self, *exc) -> None: ...
