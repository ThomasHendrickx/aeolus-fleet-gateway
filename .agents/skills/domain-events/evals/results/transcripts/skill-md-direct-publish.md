# Report

P0 (result in repo/RESULT.json): applies=true, problems=[2]. violations: pay_invoice.py and cancel_invoice.py import src.infra.bus. check_direction.py reports "direction ok" because it matches only `src.infra.bus` exactly and misses `from src.infra import bus`, so I found these by reading the imports.

P4: scope was pay_invoice only. cancel_invoice is untouched (another team's rewrite).
- pay_invoice no longer publishes. Invoice.pay records an InvoicePaid event (added to docs/event-list.md and sales/core/events.py).
- PgInvoiceRepository.save writes recorded events to a new `outbox` table (schema.sql) in the same transaction.
- New relay src/sales/adapters/relay.py publishes after commit, at least once, and maps the event to the contract src/contracts/invoice_paid.py. Topic and payload are unchanged, so the Shipping consumer works as before.
- Tests in tests/test_payment_notice.py: payment gives one outbox row and no direct bus message; a failed save gives no notice; contract payload; the existing flow now goes through the relay.
- check_direction.py: ok. unittest: 9 tests OK.

Not done: the Shipping consumer is not made idempotent (P3 is out of scope). Nothing runs the relay in production; it must be scheduled or polled. The outbox write is in the repository's save, which affects every save but only emits for events the aggregate records.
