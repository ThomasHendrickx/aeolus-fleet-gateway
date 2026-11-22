from datetime import date

from src.shipping.core.shipments import Shipment


def create_shipment(uow, shipment_id: str, order_id: str) -> str:
    with uow:
        uow.shipments.add(Shipment(shipment_id, order_id))
    return shipment_id


def dispatch_shipment(uow, shipment_id: str, carrier: str, on: date) -> str:
    with uow:
        shipment = uow.shipments.get(shipment_id)
        shipment.dispatch(carrier, on)
        uow.shipments.save(shipment)
    return shipment_id
