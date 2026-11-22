from src.core.customers import Customer


class CustomerNotFound(Exception):
    pass


class PgCustomerRepository:
    def __init__(self, conn):
        self.conn = conn

    def get(self, customer_id):
        row = self.conn.execute("SELECT id, name, email, created_on FROM customers WHERE id = %s", (customer_id,)).fetchone()
        if row is None:
            raise CustomerNotFound(customer_id)
        return Customer(*row)

    def save(self, customer):
        self.conn.execute(
            "INSERT INTO customers (id, name, email, created_on) VALUES (%s, %s, %s, %s)"
            " ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, email = EXCLUDED.email",
            (customer.id, customer.name, customer.email, customer.created_on))

    def list_all(self):
        return [Customer(*row) for row in self.conn.execute("SELECT id, name, email, created_on FROM customers ORDER BY id").fetchall()]
