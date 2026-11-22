from datetime import date

from src.core.orders import Address, Order, OrderLine


def place_order(uow, order_id: str, number: str, customer_id: str, placed_on: date, address: Address, lines: list) -> str:
    order = Order(order_id, number, customer_id, placed_on, address, [OrderLine(**line) for line in lines])
    with uow:
        uow.customers.get(customer_id)
        uow.orders.save(order)
    return order.id
