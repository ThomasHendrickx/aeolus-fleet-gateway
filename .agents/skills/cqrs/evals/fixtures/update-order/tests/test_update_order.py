from src import main
from src.adapters.pg_unit_of_work import PgUnitOfWork
from src.core.orders import OrderError
from tests.support import DbTest


def load(order_id):
    with PgUnitOfWork() as uow:
        return uow.orders.get(order_id)


class UpdateOrderTest(DbTest):
    def setUp(self):
        super().setUp()
        self.customer("ann")
        self.order("o1", "ann", lines=(("A", 1, 1000),))

    def test_note_changes(self):
        version = main.update_order("o1", {"note": "leave at the door"})
        self.assertEqual(load("o1").note, "leave at the door")
        self.assertEqual(version, 2)

    def test_lines_change_while_placed(self):
        main.update_order("o1", {"lines": [{"sku": "A", "quantity": 3, "unit_price_cents": 1000}]})
        self.assertEqual(load("o1").total_cents, 3000)

    def test_lines_of_a_shipped_order_do_not_change(self):
        main.ship_order("o1")
        with self.assertRaises(OrderError):
            main.update_order("o1", {"lines": [{"sku": "A", "quantity": 3, "unit_price_cents": 1000}]})
        self.assertEqual(load("o1").total_cents, 1000)
