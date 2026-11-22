from src.db import connect
from src.sales.core.invoices import Invoice
from src.sales.core.orders import Order, OrderLine
from src.sales.core.ports import NotFound


class PgOrderRepository:
    def __init__(self, conn):
        self.conn = conn

    def get(self, order_id):
        row = self.conn.execute("SELECT id, customer_id, status, version FROM orders WHERE id = %s", (order_id,)).fetchone()
        if row is None:
            raise NotFound(order_id)
        lines = self.conn.execute("SELECT sku, quantity, unit_price_cents FROM order_lines WHERE order_id = %s ORDER BY line_no",
                                  (order_id,)).fetchall()
        return Order(row[0], row[1], [OrderLine(*line) for line in lines], status=row[2], version=row[3])

    def add(self, order):
        self.conn.execute("INSERT INTO orders (id, customer_id, status) VALUES (%s, %s, %s)", (order.id, order.customer_id, order.status))
        with self.conn.cursor() as cur:
            cur.executemany("INSERT INTO order_lines (order_id, line_no, sku, quantity, unit_price_cents) VALUES (%s, %s, %s, %s, %s)",
                            [(order.id, n, l.sku, l.quantity, l.unit_price_cents) for n, l in enumerate(order.lines, 1)])


class StaleInvoice(Exception):
    pass


class PgInvoiceRepository:
    def __init__(self, conn):
        self.conn = conn

    def get(self, invoice_id):
        row = self.conn.execute("SELECT id, order_id, customer_id, amount_cents, status, paid_on, version FROM invoices WHERE id = %s",
                                (invoice_id,)).fetchone()
        if row is None:
            raise NotFound(invoice_id)
        return Invoice(*row)

    def add(self, invoice):
        self.conn.execute("INSERT INTO invoices (id, order_id, customer_id, amount_cents, status) VALUES (%s, %s, %s, %s, %s)",
                          (invoice.id, invoice.order_id, invoice.customer_id, invoice.amount_cents, invoice.status))

    def save(self, invoice):
        row = self.conn.execute("UPDATE invoices SET status = %s, paid_on = %s, version = version + 1 WHERE id = %s AND version = %s"
                                " RETURNING version", (invoice.status, invoice.paid_on, invoice.id, invoice.version)).fetchone()
        if row is None:
            raise StaleInvoice(invoice.id)
        invoice.version = row[0]


class PgSalesUnitOfWork:
    """One transaction per use case: commits when the block succeeds, rolls back when it raises."""

    def __enter__(self):
        self.conn = connect()
        self.tx = self.conn.transaction()
        self.tx.__enter__()
        self.orders = PgOrderRepository(self.conn)
        self.invoices = PgInvoiceRepository(self.conn)
        return self

    def __exit__(self, *exc):
        try:
            self.tx.__exit__(*exc)
        finally:
            self.conn.close()
