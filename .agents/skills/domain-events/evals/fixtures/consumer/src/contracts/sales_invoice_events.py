"""Integration events Sales publishes on topic `sales.invoices.v1` (producer: Sales). Version 1.

Every message body has: event_id (unique per event), type ("InvoicePaid" or "InvoiceRefunded"),
invoice_id, order_id, invoice_version (the invoice aggregate's version after the change) and
occurred_on (ISO date). The bus delivers at least once; Sales' relay retries until the bus accepts.
"""
TOPIC = "sales.invoices.v1"
INVOICE_PAID = "InvoicePaid"
INVOICE_REFUNDED = "InvoiceRefunded"
FIELDS = ("event_id", "type", "invoice_id", "order_id", "invoice_version", "occurred_on")
