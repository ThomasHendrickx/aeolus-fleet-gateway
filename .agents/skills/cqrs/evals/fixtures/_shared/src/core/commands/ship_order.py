def ship_order(uow, order_id: str) -> int:
    with uow:
        order = uow.orders.get(order_id)
        order.ship()
        uow.orders.save(order)
    return order.version
