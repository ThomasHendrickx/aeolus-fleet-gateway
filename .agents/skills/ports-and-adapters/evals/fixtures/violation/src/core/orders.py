from payments_sdk import Gateway


def pay(order_cents):
    return Gateway().charge(order_cents)["ok"]
