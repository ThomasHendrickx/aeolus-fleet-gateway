"""Stub of an ORM client: returns its own model types."""
from dataclasses import dataclass


@dataclass
class OrderModel:
    id: int
    totalCents: int
    statusCode: int  # 0 new, 1 paid, 2 shipped


class Client:
    def __init__(self, url):
        self.url = url

    def order_find_unique(self, where):
        raise RuntimeError("database call")
