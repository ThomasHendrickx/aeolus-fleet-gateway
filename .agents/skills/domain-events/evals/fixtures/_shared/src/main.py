"""Composition root: wires each context's use cases to Postgres."""
from src.sales.adapters.pg import PgSalesUnitOfWork
from src.sales.core.commands.cancel_invoice import cancel_invoice as _cancel_invoice
from src.sales.core.commands.issue_invoice import issue_invoice as _issue_invoice
from src.sales.core.commands.pay_invoice import pay_invoice as _pay_invoice
from src.sales.core.commands.place_order import place_order as _place_order
from src.shipping.adapters.pg import PgShippingUnitOfWork
from src.shipping.core import commands as shipping


def place_order(order_id, customer_id, lines):
    return _place_order(PgSalesUnitOfWork(), order_id, customer_id, lines)


def issue_invoice(invoice_id, order_id):
    return _issue_invoice(PgSalesUnitOfWork(), invoice_id, order_id)


def pay_invoice(invoice_id, paid_on):
    return _pay_invoice(PgSalesUnitOfWork(), invoice_id, paid_on)


def cancel_invoice(invoice_id):
    return _cancel_invoice(PgSalesUnitOfWork(), invoice_id)


def request_fulfilment(fulfilment_id, order_id, on):
    return shipping.request_fulfilment(PgShippingUnitOfWork(), fulfilment_id, order_id, on)


def cancel_fulfilment(order_id):
    return shipping.cancel_fulfilment(PgShippingUnitOfWork(), order_id)
