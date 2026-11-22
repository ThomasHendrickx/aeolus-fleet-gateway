from src.sales.core.orders import Order, OrderLine


def place_order(uow, order_id: str, customer_id: str, lines: list) -> str:
    order = Order.place(order_id, customer_id, [OrderLine(**line) for line in lines])
    with uow:
        uow.orders.add(order)
    return order.id
