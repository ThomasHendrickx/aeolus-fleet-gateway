

def suspend_customer(customer_id):
    from src.core.commands.customer_status import suspend_customer as _suspend
    return _suspend(PgUnitOfWork(), customer_id)


def reinstate_customer(customer_id):
    from src.core.commands.customer_status import reinstate_customer as _reinstate
    return _reinstate(PgUnitOfWork(), customer_id)


def cancel_order(order_id):
    from src.core.commands.customer_status import cancel_order as _cancel
    return _cancel(PgUnitOfWork(), order_id)
