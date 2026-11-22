from dataclasses import dataclass
from datetime import date


@dataclass
class Fulfilment:
    id: str
    order_id: str
    requested_on: date
    status: str = "requested"

    def cancel(self) -> None:
        self.status = "cancelled"
