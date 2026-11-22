from src.adapters.pg_unit_of_work import PgUnitOfWork


def customer_panel(customer_id):
    """Staff side panel next to a support ticket: the customer's last 5 orders."""
    with PgUnitOfWork() as uow:
        customer = uow.customers.get(customer_id)
        orders = uow.orders.find_recent_for_customer(customer_id, 5)
    return {"name": customer.name, "email": customer.email, "recent": [{"number": o.number, "status": o.status} for o in orders]}
