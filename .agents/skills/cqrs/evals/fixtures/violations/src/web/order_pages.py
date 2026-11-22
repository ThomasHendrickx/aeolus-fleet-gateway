from src import main
from src.queries.customer_card import customer_card
from src.queries.order_summary import order_summary


def order_page(order_id, customer_id):
    return {"customer": customer_card(customer_id), "order": order_summary(order_id)}


def post_cancel(order_id):
    return {"version": main.cancel_order(order_id)}
