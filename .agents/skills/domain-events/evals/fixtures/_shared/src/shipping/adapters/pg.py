from src.db import connect
from src.shipping.core.fulfilments import Fulfilment


class PgFulfilmentRepository:
    def __init__(self, conn):
        self.conn = conn

    def add(self, fulfilment):
        self.conn.execute("INSERT INTO fulfilments (id, order_id, status, requested_on) VALUES (%s, %s, %s, %s)",
                          (fulfilment.id, fulfilment.order_id, fulfilment.status, fulfilment.requested_on))

    def for_order(self, order_id):
        rows = self.conn.execute("SELECT id, order_id, requested_on, status FROM fulfilments WHERE order_id = %s ORDER BY id",
                                 (order_id,)).fetchall()
        return [Fulfilment(*row) for row in rows]

    def save(self, fulfilment):
        self.conn.execute("UPDATE fulfilments SET status = %s WHERE id = %s", (fulfilment.status, fulfilment.id))


class PgShippingUnitOfWork:
    """Shipping's own transaction per use case."""

    def __enter__(self):
        self.conn = connect()
        self.tx = self.conn.transaction()
        self.tx.__enter__()
        self.fulfilments = PgFulfilmentRepository(self.conn)
        return self

    def __exit__(self, *exc):
        try:
            self.tx.__exit__(*exc)
        finally:
            self.conn.close()
