# Report
- P0: scan found src/sales/core/commands/pay_invoice.py importing src.infra.mail (rule 2). Problems: [2] (receipt sent before commit). Problem 1/3/4 not held: the bus publish request has no consumer. applies=true. RESULT.json written.
- P1: added InvoicePaid to docs/event-list.md and events.py; Invoice.pay records it; sales_outbox table in schema.sql; PgInvoiceRepository.save writes the row in the same transaction; src/sales/adapters/relay.py sends the receipt mail after commit, retrying failed rows on the next run; main.pay_invoice runs the relay after the use case. pay_invoice no longer imports mail. Tests added in tests/test_receipt.py (commit -> one row, rollback -> none/no mail, relay failure retried then mailed once).
- P2/P3: stopped at P2 step 1: no consumer has asked, so no integration event/contract, nothing published on the bus (a test asserts bus_messages stays empty). P3 not run (no consumer).
- P4: the one direct side effect (mail in pay_invoice) replaced via P1; old path removed (nothing else used it).
- Checks: direction ok; 10 tests pass; rescan shows no violations.
- Not done: no dead-letter/alert for relay (only retry with attempts/last_error), as that is a consumer rule (P3).
