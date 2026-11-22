from datetime import date

from src.infra import bus


def pay_invoice(uow, invoice_id: str, paid_on: date) -> int:
    with uow:
        invoice = uow.invoices.get(invoice_id)
        invoice.pay(paid_on)
        bus.publish("sales.invoice-paid", {"invoice_id": invoice.id, "order_id": invoice.order_id, "paid_on": paid_on.isoformat()})
        uow.invoices.save(invoice)
    return invoice.version
