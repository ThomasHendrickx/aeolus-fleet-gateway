from src.adapters import cron_refunds, rest_invoices, rest_refunds, rest_users

ROUTES = {
    "POST /refunds": rest_refunds.post_refund,
    "POST /users": rest_users.post_user,
    "POST /invoices": rest_invoices.post_invoice,
}
JOBS = {"nightly refunds": cron_refunds.settle}
