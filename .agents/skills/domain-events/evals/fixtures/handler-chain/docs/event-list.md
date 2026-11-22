# Domain event list

Every domain event, per bounded context, named as a past-tense fact. Add an event here before it exists in code.

## sales

- OrderPlaced: a customer placed an order (order id, customer id, total).
- InvoiceIssued: an invoice was issued for an order (invoice id, order id, amount).
- InvoicePaid: a customer paid an invoice (invoice id, order id, amount, date).

## shipping

None yet.
