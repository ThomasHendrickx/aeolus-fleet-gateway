from src import main


def put_order(order_id, body):
    """Staff edit screen saves the whole order form."""
    return {"version": main.update_order(order_id, body)}
