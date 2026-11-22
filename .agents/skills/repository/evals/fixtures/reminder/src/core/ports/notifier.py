from typing import Protocol


class Notifier(Protocol):
    def send(self, customer_id: str, subject: str, body: str) -> None: ...
