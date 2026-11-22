from datetime import date

from src.queries.monthly_revenue import monthly_revenue


def monthly_revenue_report(today=None):
    """Finance report: revenue per month, last 24 months, newest first."""
    return {"months": [{"month": m.month.isoformat(), "revenue_cents": m.revenue_cents, "invoices": m.invoices}
                       for m in monthly_revenue(today or date.today())]}
