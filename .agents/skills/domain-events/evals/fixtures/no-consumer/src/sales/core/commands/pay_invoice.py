from datetime import date

from src.infra import mail


def pay_invoice(uow, invoice_id: str, paid_on: date) -> int:
    with uow:
        invoice = uow.invoices.get(invoice_id)
        invoice.pay(paid_on)
        mail.send(f"{invoice.customer_id}@example.com", f"Receipt for invoice {invoice.id}",
                  f"We received {invoice.amount_cents / 100:.2f} on {paid_on.isoformat()}.")
        uow.invoices.save(invoice)
    return invoice.version
