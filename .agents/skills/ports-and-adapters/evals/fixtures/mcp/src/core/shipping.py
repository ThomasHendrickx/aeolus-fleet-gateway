"""Use case: ship an order. Pure domain logic over plain values."""


def ship_order(order, carrier):
    if order["status"] != "paid":
        raise ValueError("only paid orders ship")
    return {**order, "status": "shipped", "carrier": carrier}
