# Report
- P0: no scripts exist in the skill folder, so I checked by hand. No query-to-domain imports and no command-handler-to-query imports, so violations is empty. Problems 1 and 2 apply (a rollup, and a measured p95 of 2.4 s against a 300 ms budget). applies=true. Wrote RESULT.json.
- P2: the evidence is the measurement over budget. Added the projection table `monthly_revenue_projection` and the idempotency table `monthly_revenue_applied` to schema.sql.
  - Added src/adapters/revenue_projection.py. Its trigger is the same transaction as the invoice command, called from PgInvoiceRepository.add and save. Staleness is zero, so Finance sees an issue or void immediately.
  - The idempotency key is (invoice_id, change). The rebuild is `python3 -m src.adapters.revenue_projection`.
  - The query handler now reads the projection.
  - Added tests: issue and void are visible immediately, a change applied twice counts once, and rebuild equals incremental.
- Ran check_direction.py (ok) and the unit tests (8 pass). Ran the rebuild once against the database. Wrote PROJECTION.json (process is null because the projection is synchronous).
- Not done: no outbox, since the trigger is synchronous. I did not re-run the staging performance measurement. The rebuild locks `invoices` in SHARE MODE while it runs.
