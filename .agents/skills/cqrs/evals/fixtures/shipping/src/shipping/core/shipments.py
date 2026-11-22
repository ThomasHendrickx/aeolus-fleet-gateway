from dataclasses import dataclass
from datetime import date


class ShipmentError(Exception):
    pass


@dataclass
class Shipment:
    id: str
    order_id: str
    status: str = "pending"
    carrier: str | None = None
    dispatched_on: date | None = None

    def dispatch(self, carrier: str, on: date):
        if self.status != "pending":
            raise ShipmentError(f"cannot dispatch a {self.status} shipment")
        self.status, self.carrier, self.dispatched_on = "dispatched", carrier, on
