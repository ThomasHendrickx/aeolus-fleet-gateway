

def cancel_order(order_id):
    from src.core.commands.cancel_order import cancel_order as _cancel_order
    return _cancel_order(PgUnitOfWork(), order_id)
