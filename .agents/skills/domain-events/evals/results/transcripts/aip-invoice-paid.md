# Report (domain-events skill, invoice-paid)

Steps run
- P0: scan_infra_imports.py found no violations. Problems 1, 2 and 3 hold (Shipping must learn of payments; a publish needs an outbox so it happens after commit; none exists). Problem 4 does not apply to Sales (the consumer is Shipping's). applies = true. Result written to repo/RESULT.json.
- P1: added InvoicePaid to docs/event-list.md first. Invoice.pay records InvoicePaid. pay_invoice writes it to a new sales_outbox table (schema.sql) in the same transaction, through uow.outbox (PgOutbox). Relay in src/sales/adapters/relay.py (wired as main.relay_sales_outbox) publishes after commit, at least once, with retry. Scenario tests in tests/test_invoice_paid_event.py (commit gives one row, failure/rollback gives none).
- P2: contract src/contracts/invoice_paid.py (InvoicePaid v1: event_id, invoice_id, order_id, paid_on, invoice_version; ids and facts only, no state transfer). The relay maps the internal event to it. Contract test checks the payload fields.
- P3 skipped: the consumer is Shipping's (task says they write it). The event_id and invoice_version are there for their idempotency and ordering checks.
- P4 skipped: no direct publish or handler chain existed.
- Checks (run_check.py): check_direction.py and unittest both pass (11 tests).

Not done
- No Shipping consumer, dead-letter or alert (out of Sales scope). The relay leaves rows that exhausted retries with last_error set and does not alert.
