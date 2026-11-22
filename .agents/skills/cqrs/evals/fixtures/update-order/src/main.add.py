

def update_order(order_id, dto):
    from src.core.commands.update_order import update_order as _update
    return _update(PgUnitOfWork(), order_id, dto)
