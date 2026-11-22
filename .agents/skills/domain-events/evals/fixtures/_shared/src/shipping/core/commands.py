from datetime import date

from src.shipping.core.fulfilments import Fulfilment


def request_fulfilment(uow, fulfilment_id: str, order_id: str, on: date) -> str:
    with uow:
        uow.fulfilments.add(Fulfilment(fulfilment_id, order_id, on))
    return fulfilment_id


def cancel_fulfilment(uow, order_id: str) -> None:
    with uow:
        for fulfilment in uow.fulfilments.for_order(order_id):
            fulfilment.cancel()
            uow.fulfilments.save(fulfilment)
