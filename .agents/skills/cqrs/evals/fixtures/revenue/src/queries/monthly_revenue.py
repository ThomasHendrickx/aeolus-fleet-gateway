from dataclasses import dataclass
from datetime import date

from src.db import connect


@dataclass(frozen=True)
class MonthRevenue:
    month: date
    revenue_cents: int
    invoices: int


SQL = """
SELECT date_trunc('month', issued_on)::date AS month, sum(amount_cents) AS revenue_cents, count(*) AS invoices
FROM invoices
WHERE NOT voided AND issued_on >= (date_trunc('month', %(today)s::date) - interval '23 months')::date AND issued_on <= %(today)s
GROUP BY 1
ORDER BY 1 DESC
"""


def monthly_revenue(today: date) -> list:
    """Revenue per calendar month for the last 24 months (this month included), voided invoices excluded."""
    with connect() as conn:
        return [MonthRevenue(*row) for row in conn.execute(SQL, {"today": today}).fetchall()]
