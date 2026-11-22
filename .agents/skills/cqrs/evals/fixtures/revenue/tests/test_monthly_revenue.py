from datetime import date

from src import main
from src.queries.monthly_revenue import monthly_revenue
from tests.support import DbTest


class MonthlyRevenueTest(DbTest):
    def setUp(self):
        super().setUp()
        self.customer("ann")

    def test_revenue_per_month_without_voided(self):
        main.issue_invoice("i1", "ann", 1000, date(2026, 10, 3))
        main.issue_invoice("i2", "ann", 500, date(2026, 10, 20))
        main.issue_invoice("i3", "ann", 700, date(2026, 11, 1))
        main.issue_invoice("i4", "ann", 900, date(2026, 11, 2))
        main.void_invoice("i4")
        rows = monthly_revenue(date(2026, 11, 7))
        self.assertEqual([(r.month, r.revenue_cents, r.invoices) for r in rows],
                         [(date(2026, 11, 1), 700, 1), (date(2026, 10, 1), 1500, 2)])

    def test_only_last_24_months(self):
        main.issue_invoice("old", "ann", 1000, date(2024, 11, 30))
        main.issue_invoice("in", "ann", 1000, date(2024, 12, 1))
        self.assertEqual([r.month for r in monthly_revenue(date(2026, 11, 7))], [date(2024, 12, 1)])

    def test_empty(self):
        self.assertEqual(monthly_revenue(date(2026, 11, 7)), [])
