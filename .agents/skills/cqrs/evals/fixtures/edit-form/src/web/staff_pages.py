from src.adapters.pg_unit_of_work import PgUnitOfWork


def order_edit_form(order_id):
    """Staff edit form for one order."""
    with PgUnitOfWork() as uow:
        return uow.orders.get(order_id).to_form()
