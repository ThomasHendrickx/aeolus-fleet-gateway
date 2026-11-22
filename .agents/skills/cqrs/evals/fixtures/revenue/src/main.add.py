

def issue_invoice(invoice_id, customer_id, amount_cents, issued_on):
    from src.core.commands.invoicing import issue_invoice as _issue
    return _issue(PgUnitOfWork(), invoice_id, customer_id, amount_cents, issued_on)


def void_invoice(invoice_id):
    from src.core.commands.invoicing import void_invoice as _void
    return _void(PgUnitOfWork(), invoice_id)
