from src.adapters.pg_unit_of_work import PgUnitOfWork
from src.core.loyalty import loyalty_tier

PAGE_SIZE = 25


def customer_list(page=1):
    """Staff customer list: name, email and loyalty tier, by name."""
    with PgUnitOfWork() as uow:
        rows = []
        for customer in uow.customers.list_all():
            orders = uow.orders.list_for_customer(customer.id)
            counted = sum(1 for o in orders if o.status != "cancelled")
            rows.append({"customer_id": customer.id, "name": customer.name, "email": customer.email,
                         "tier": loyalty_tier(counted, customer.suspended)})
    start = (page - 1) * PAGE_SIZE
    return {"page": page, "rows": rows[start:start + PAGE_SIZE]}
