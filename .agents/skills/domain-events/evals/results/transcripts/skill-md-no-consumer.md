# Report

P0: violation: pay_invoice (use case) imported src.infra.mail (rule 2). Problems: [2] (side effect before commit, no outbox). Problem 3 not counted: people ask Sales, nobody polls. applies=true. RESULT.json written first.

P1 (receipt fix): added InvoicePaid to docs/event-list.md and src/sales/core/events.py; Invoice.pay records it; PgInvoiceRepository.save writes it to new table sales_outbox (schema.sql) in the same transaction (after the version check, so a stale save rolls back with no row); pay_invoice no longer imports mail; new src/sales/adapters/relay.py sends the receipt after commit, at least once, marks rows dispatched; src/main.py runs relay_outbox after pay_invoice. Tests added in tests/test_receipt.py (one outbox row on commit, none and no mail on concurrent-update failure, relay twice sends once). check_direction.py: ok; unittest: 9 pass.

P2: stopped at step 1. No consumer has asked to subscribe, so no integration event/contract was published to the bus (src/contracts untouched).

Not done: no retry/backoff in the relay (a failed send leaves the row undispatched for the next relay run); no separate relay process.
