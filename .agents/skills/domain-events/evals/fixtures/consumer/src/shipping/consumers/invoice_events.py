"""Shipping's handler for Sales' invoice events: a payment requests fulfilment, a refund cancels it."""
from datetime import date
from uuid import uuid4

from src import main
from src.contracts import sales_invoice_events as contract


def handle(body: dict) -> None:
    if body["type"] == contract.INVOICE_PAID:
        main.request_fulfilment(f"f-{uuid4().hex[:12]}", body["order_id"], date.fromisoformat(body["occurred_on"]))
    elif body["type"] == contract.INVOICE_REFUNDED:
        main.cancel_fulfilment(body["order_id"])
