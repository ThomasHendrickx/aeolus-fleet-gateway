from src.adapters.pg_unit_of_work import PgUnitOfWork


def my_orders_page(customer_id):
    """Customer's 'My orders' page: their 10 most recent orders."""
    with PgUnitOfWork() as uow:
        orders = uow.orders.find_recent_for_customer(customer_id, 10)
    return {"rows": [{"number": o.number, "placed_on": o.placed_on.isoformat(), "status": o.status, "total_cents": o.total_cents}
                     for o in orders]}
