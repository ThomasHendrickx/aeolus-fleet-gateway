from src.adapters.pg_customers import PgCustomerRepository
from src.adapters.pg_orders import PgOrderRepository
from src.db import connect


class PgUnitOfWork:
    """One transaction per use case: commits when the block succeeds, rolls back when it raises."""

    def __enter__(self):
        self.conn = connect()
        self.tx = self.conn.transaction()
        self.tx.__enter__()
        self.orders = PgOrderRepository(self.conn)
        self.customers = PgCustomerRepository(self.conn)
        return self

    def __exit__(self, *exc):
        try:
            self.tx.__exit__(*exc)
        finally:
            self.conn.close()
