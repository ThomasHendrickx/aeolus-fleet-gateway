from src.queries.my_orders import my_orders

PAGE_SIZE = 10


def my_orders_page(customer_id, page=1):
    """Customer's 'My orders' page, newest first, with shipping status."""
    return {"page": page, "rows": [vars(row) for row in my_orders(customer_id, page, PAGE_SIZE)]}
