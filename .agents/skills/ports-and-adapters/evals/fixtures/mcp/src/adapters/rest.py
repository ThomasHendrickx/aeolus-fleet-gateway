from src.core import shipping


def post_ship(body):
    try:
        return 200, shipping.ship_order(body["order"], body["carrier"])
    except ValueError as error:
        return 422, {"error": str(error)}
