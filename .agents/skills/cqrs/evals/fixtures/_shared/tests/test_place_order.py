from src.adapters.pg_unit_of_work import PgUnitOfWork
from src.core.ports import DuplicateOrderNumber
from tests.support import DbTest


class PlaceOrderTest(DbTest):
    def test_order_keeps_its_lines_and_total(self):
        self.customer("ann")
        self.order("o1", "ann", lines=(("A", 2, 500), ("B", 1, 250)))
        with PgUnitOfWork() as uow:
            order = uow.orders.get("o1")
        self.assertEqual(order.total_cents, 1250)
        self.assertEqual([l.sku for l in order.lines], ["A", "B"])

    def test_order_number_is_unique(self):
        self.customer("ann")
        self.order("o1", "ann", number="N-1")
        with self.assertRaises(DuplicateOrderNumber):
            self.order("o2", "ann", number="N-1")
