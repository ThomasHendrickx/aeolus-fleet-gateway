"""Order notes. Payment goes through payments_sdk elsewhere; nothing here imports it."""
NOTE = "paid via payments_sdk"


def label(order_id):
    return f"order {order_id}: {NOTE}"
