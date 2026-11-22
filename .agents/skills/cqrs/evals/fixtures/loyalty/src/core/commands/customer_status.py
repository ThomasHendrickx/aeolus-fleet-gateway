def suspend_customer(uow, customer_id: str) -> str:
    with uow:
        customer = uow.customers.get(customer_id)
        customer.suspend()
        uow.customers.save(customer)
    return customer_id


def reinstate_customer(uow, customer_id: str) -> str:
    with uow:
        customer = uow.customers.get(customer_id)
        customer.reinstate()
        uow.customers.save(customer)
    return customer_id


def cancel_order(uow, order_id: str) -> int:
    with uow:
        order = uow.orders.get(order_id)
        order.cancel()
        uow.orders.save(order)
    return order.version
