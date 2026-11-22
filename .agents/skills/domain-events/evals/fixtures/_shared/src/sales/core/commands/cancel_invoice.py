def cancel_invoice(uow, invoice_id: str) -> int:
    with uow:
        invoice = uow.invoices.get(invoice_id)
        invoice.cancel()
        uow.invoices.save(invoice)
    return invoice.version
