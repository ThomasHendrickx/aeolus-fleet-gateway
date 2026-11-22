import copy

from src.core.errors import DuplicateOrderNumber


class InMemoryOrders:
    def __init__(self):
        self._orders = {}

    def get(self, order_id):
        order = self._orders.get(order_id)
        return copy.deepcopy(order) if order else None

    def save(self, order):
        if any(o.number == order.number and o.id != order.id for o in self._orders.values()):
            raise DuplicateOrderNumber(order.number)
        self._orders[order.id] = copy.deepcopy(order)

    def list_for_customer(self, customer_id):
        mine = [o for o in self._orders.values() if o.customer_id == customer_id]
        return sorted(mine, key=lambda o: (o.due, o.number))
