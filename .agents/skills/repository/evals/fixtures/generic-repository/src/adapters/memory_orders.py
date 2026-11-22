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

    def find_by(self, where):
        def matches(order):
            return (
                ("status" not in where or order.status == where["status"])
                and ("customer_id" not in where or order.customer_id == where["customer_id"])
                and ("due_before" not in where or order.due < where["due_before"])
            )

        return sorted((o for o in self._orders.values() if matches(o)), key=lambda o: (o.due, o.number))
