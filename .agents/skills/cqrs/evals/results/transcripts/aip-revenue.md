# Report

Steps run: P0 (scan_query_imports.py: no violations; problems 1 and 2 hold: a rollup across invoices, and the 2.4 s p95 misses the 300 ms budget; applies = true; written to repo/RESULT.json). P2 (level 2 projection; evidence is the measurement over budget).

Changes (in repo):
- schema.sql: tables monthly_revenue_projection (month, revenue_cents, invoices) and monthly_revenue_applied (idempotency key invoice_id + change).
- src/adapters/pg_revenue_projection.py: updater and rebuild. Trigger: same transaction as the invoice change (PgInvoiceRepository.add/save call it on their connection), so staleness is 0 and finance sees issue/void immediately (read-your-own-writes). Idempotency key (invoice_id, change). Rebuild: python3 -m src.adapters.pg_revenue_projection.
- src/queries/monthly_revenue.py: now reads the projection (same read type and port); months with zero invoices are filtered out.
- tests/test_monthly_revenue.py: scenarios for immediate visibility after issue/void, double-apply, rollback, rebuild equals incremental.
- repo/PROJECTION.json written (process null: same-transaction trigger).

Checks: check_direction.py ok; 9 tests pass. I ran rebuild once on the live DB after the test reset.

Notes: no outbox or domain-events needed (same context and transaction). Existing production data needs the rebuild command run once after the schema is applied. Minor semantic difference: the old query excluded invoices dated after `today` within the current month; the projection is month-grained and includes them. I could not measure the 300 ms budget on production-sized data here.
