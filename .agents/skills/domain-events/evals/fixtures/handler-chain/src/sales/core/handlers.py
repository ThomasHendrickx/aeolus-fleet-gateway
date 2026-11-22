"""Reactions to sales events. The unit of work dispatches each recorded event to its handlers before it commits."""
from src.sales.core.events import InvoicePaid


def credit_customer_account(uow, event: InvoicePaid) -> None:
    account = uow.accounts.get(event.customer_id)
    account.record_payment(event.amount_cents)
    uow.accounts.save(account)


def send_payment_receipt(uow, event: InvoicePaid) -> None:
    account = uow.accounts.get(event.customer_id)
    uow.mailer.send(account.email, f"Receipt for invoice {event.invoice_id}",
                    f"We received {event.amount_cents / 100:.2f} on {event.paid_on}.")


HANDLERS = {InvoicePaid: [credit_customer_account, send_payment_receipt]}
