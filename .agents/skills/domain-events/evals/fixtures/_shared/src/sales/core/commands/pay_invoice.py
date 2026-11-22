from datetime import date


def pay_invoice(uow, invoice_id: str, paid_on: date) -> int:
    with uow:
        invoice = uow.invoices.get(invoice_id)
        invoice.pay(paid_on)
        uow.invoices.save(invoice)
    return invoice.version
