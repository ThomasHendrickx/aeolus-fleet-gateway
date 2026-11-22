from src.core.orders import OrderError
from src.queries.order_summary import order_summary


def cancel_order(uow, order_id: str) -> int:
    if order_summary(order_id)["status"] != "placed":
        raise OrderError("only a placed order can be cancelled")
    with uow:
        order = uow.orders.get(order_id)
        order.cancel()
        uow.orders.save(order)
    return order.version
