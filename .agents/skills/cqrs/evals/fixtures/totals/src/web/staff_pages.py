from src.adapters.pg_unit_of_work import PgUnitOfWork

PAGE_SIZE = 20


def customer_totals_page(page=1, min_orders=0):
    """Staff page: each customer's order count and total spent, highest spender first."""
    with PgUnitOfWork() as uow:
        orders = uow.orders.list_all()
        customers = {c.id: c for c in uow.customers.list_all()}
    totals = {}
    for order in orders:
        if order.status == "cancelled":
            continue
        row = totals.setdefault(order.customer_id, {"orders": 0, "total_cents": 0})
        row["orders"] += 1
        row["total_cents"] += order.total_cents
    rows = [{"customer_id": cid, "name": customers[cid].name, **t} for cid, t in totals.items() if t["orders"] >= min_orders]
    rows.sort(key=lambda r: (-r["total_cents"], r["name"]))
    start = (page - 1) * PAGE_SIZE
    return {"page": page, "rows": rows[start:start + PAGE_SIZE]}
