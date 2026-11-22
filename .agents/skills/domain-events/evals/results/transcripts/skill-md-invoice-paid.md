# Report

P0: no infra imports in domain/use cases (violations []); problem 1 (cross-context work triggered by a state change); applies true. Written to repo/RESULT.json. Dependency check re-run after changes: direction ok.

P1: added InvoicePaid to docs/event-list.md first; InvoicePaid event in sales core/events.py, recorded by Invoice.pay; sales_outbox table in schema.sql; pay_invoice writes it to the outbox in the same unit of work (PgOutbox in sales/adapters/pg.py); relay src/sales/adapters/relay.py publishes after commit with retry (3 attempts, rows stay unpublished and are retried on next run); main.pay_invoice runs the relay after commit. Tests: commit gives one row, failed/rolled-back payment gives none.

P2: Consumer is Shipping (needs order id and paid date to request fulfilment). Contract src/contracts/invoice_paid.py (topic sales.invoice-paid.v1: event_id, invoice_id, invoice_version, order_id, paid_on; ids and facts only, no state transfer); relay maps the internal event to it; contract test in tests/test_invoice_paid_contract.py. All 12 tests and check_direction pass.

Not done: P3 (Shipping writes the consumer). No scheduled relay process beyond the post-commit call in main; only InvoicePaid is relayed (OrderPlaced/InvoiceIssued stay internal, outbox rows only for payment).
