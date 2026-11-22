from src.infra import bus


def cancel_invoice(uow, invoice_id: str) -> int:
    with uow:
        invoice = uow.invoices.get(invoice_id)
        invoice.cancel()
        uow.invoices.save(invoice)
    bus.publish("sales.invoice-cancelled", {"invoice_id": invoice.id, "order_id": invoice.order_id})
    return invoice.version
