from datetime import date

from src.core.invoices import Invoice


def issue_invoice(uow, invoice_id: str, customer_id: str, amount_cents: int, issued_on: date) -> str:
    with uow:
        uow.customers.get(customer_id)
        uow.invoices.add(Invoice(invoice_id, customer_id, amount_cents, issued_on))
    return invoice_id


def void_invoice(uow, invoice_id: str) -> str:
    with uow:
        invoice = uow.invoices.get(invoice_id)
        invoice.void()
        uow.invoices.save(invoice)
    return invoice_id
