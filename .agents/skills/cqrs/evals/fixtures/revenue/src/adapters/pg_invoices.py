from src.core.invoices import Invoice


class InvoiceNotFound(Exception):
    pass


class PgInvoiceRepository:
    def __init__(self, conn):
        self.conn = conn

    def get(self, invoice_id):
        row = self.conn.execute("SELECT id, customer_id, amount_cents, issued_on, voided FROM invoices WHERE id = %s", (invoice_id,)).fetchone()
        if row is None:
            raise InvoiceNotFound(invoice_id)
        return Invoice(*row)

    def add(self, invoice):
        self.conn.execute("INSERT INTO invoices (id, customer_id, amount_cents, issued_on, voided) VALUES (%s, %s, %s, %s, %s)",
                          (invoice.id, invoice.customer_id, invoice.amount_cents, invoice.issued_on, invoice.voided))

    def save(self, invoice):
        self.conn.execute("UPDATE invoices SET voided = %s WHERE id = %s", (invoice.voided, invoice.id))
