from src.db import connect
from src.shipping.core.shipments import Shipment


class ShipmentNotFound(Exception):
    pass


class PgShipmentRepository:
    def __init__(self, conn):
        self.conn = conn

    def get(self, shipment_id):
        row = self.conn.execute("SELECT id, order_id, status, carrier, dispatched_on FROM shipments WHERE id = %s", (shipment_id,)).fetchone()
        if row is None:
            raise ShipmentNotFound(shipment_id)
        return Shipment(*row)

    def add(self, shipment):
        self.conn.execute("INSERT INTO shipments (id, order_id, status) VALUES (%s, %s, %s)", (shipment.id, shipment.order_id, shipment.status))

    def save(self, shipment):
        self.conn.execute("UPDATE shipments SET status = %s, carrier = %s, dispatched_on = %s WHERE id = %s",
                          (shipment.status, shipment.carrier, shipment.dispatched_on, shipment.id))


class ShippingUnitOfWork:
    """Shipping's own transaction per use case: commits when the block succeeds, rolls back when it raises."""

    def __enter__(self):
        self.conn = connect()
        self.tx = self.conn.transaction()
        self.tx.__enter__()
        self.shipments = PgShipmentRepository(self.conn)
        return self

    def __exit__(self, *exc):
        try:
            self.tx.__exit__(*exc)
        finally:
            self.conn.close()
