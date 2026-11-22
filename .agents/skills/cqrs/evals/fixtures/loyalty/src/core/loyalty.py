GOLD_AFTER_ORDERS = 10


def loyalty_tier(counted_orders: int, suspended: bool) -> str:
    """Gold: more than 10 orders that were not cancelled, unless suspended. Everyone else: standard."""
    return "gold" if counted_orders > GOLD_AFTER_ORDERS and not suspended else "standard"
