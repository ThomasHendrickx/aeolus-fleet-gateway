from src.db import connect
from src.infra import mail
from src.sales.core.accounts import CustomerAccount
from src.sales.core.handlers import HANDLERS
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
    def __init__(self, conn, seen):
        self.conn = conn
        self.seen = seen

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
        self.seen.append(invoice)
        row = self.conn.execute("UPDATE invoices SET status = %s, paid_on = %s, version = version + 1 WHERE id = %s AND version = %s"
                                " RETURNING version", (invoice.status, invoice.paid_on, invoice.id, invoice.version)).fetchone()
        if row is None:
            raise StaleInvoice(invoice.id)
        invoice.version = row[0]


class PgAccountRepository:
    def __init__(self, conn):
        self.conn = conn

    def get(self, customer_id):
        row = self.conn.execute("SELECT customer_id, email, paid_total_cents, version FROM customer_accounts WHERE customer_id = %s",
                                (customer_id,)).fetchone()
        if row is None:
            raise NotFound(customer_id)
        return CustomerAccount(*row)

    def add(self, account):
        self.conn.execute("INSERT INTO customer_accounts (customer_id, email) VALUES (%s, %s)", (account.customer_id, account.email))

    def save(self, account):
        row = self.conn.execute("UPDATE customer_accounts SET paid_total_cents = %s, version = version + 1"
                                " WHERE customer_id = %s AND version = %s RETURNING version",
                                (account.paid_total_cents, account.customer_id, account.version)).fetchone()
        if row is None:
            raise StaleInvoice(account.customer_id)
        account.version = row[0]


class SmtpMailer:
    def send(self, to_address, subject, body):
        mail.send(to_address, subject, body)


class PgSalesUnitOfWork:
    """One transaction per use case: commits when the block succeeds, rolls back when it raises."""

    def __enter__(self):
        self.conn = connect()
        self.tx = self.conn.transaction()
        self.tx.__enter__()
        self.orders = PgOrderRepository(self.conn)
        self.seen = []
        self.invoices = PgInvoiceRepository(self.conn, self.seen)
        self.accounts = PgAccountRepository(self.conn)
        self.mailer = SmtpMailer()
        return self

    def __exit__(self, *exc):
        try:
            if exc[0] is None:
                try:
                    self.dispatch()
                except BaseException as error:
                    self.tx.__exit__(type(error), error, error.__traceback__)
                    raise
            self.tx.__exit__(*exc)
        finally:
            self.conn.close()

    def dispatch(self):
        """Hand each recorded event to its handlers, inside this transaction."""
        while self.seen:
            aggregate = self.seen.pop(0)
            while aggregate.events:
                event = aggregate.events.pop(0)
                for handler in HANDLERS.get(type(event), []):
                    handler(self, event)
