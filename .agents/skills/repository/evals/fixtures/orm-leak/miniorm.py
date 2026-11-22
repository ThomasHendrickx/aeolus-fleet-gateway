"""A tiny stand-in for an ORM: a query object the database layer understands."""
from dataclasses import dataclass, field


@dataclass
class Query:
    table: str
    filters: dict = field(default_factory=dict)
    order_by: str = ""

    def where(self, **filters):
        return Query(self.table, {**self.filters, **filters}, self.order_by)

    def order(self, column):
        return Query(self.table, self.filters, column)

    def sql(self):
        clause = " AND ".join(f"{k} = ?" for k in self.filters)
        text = f"SELECT * FROM {self.table}" + (f" WHERE {clause}" if clause else "")
        return text + (f" ORDER BY {self.order_by}" if self.order_by else ""), list(self.filters.values())
