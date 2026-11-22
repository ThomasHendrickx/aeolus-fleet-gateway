from src.adapters import schema


class SqliteUnitOfWork:
    """One database transaction: commits when the block ends, rolls back on an error."""

    def __init__(self, path=":memory:"):
        self.connection = schema.connect(path)

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        if exc_type is None:
            self.connection.commit()
        else:
            self.connection.rollback()
        return False
