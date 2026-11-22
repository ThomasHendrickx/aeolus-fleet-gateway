from src.sales.core.invoices import Invoice


def issue_invoice(uow, invoice_id: str, order_id: str) -> str:
    with uow:
        order = uow.orders.get(order_id)
        uow.invoices.add(Invoice.issue(invoice_id, order))
    return invoice_id
