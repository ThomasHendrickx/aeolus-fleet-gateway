# Agent report

Steps run: P0 (scan_query_imports: no violations; problem 3 holds, since the page reads Shipping's `shipments` table; applies = true; written to RESULT.json), then P2, using the domain-events skill for the events. P1 and the P3/P4 paths were not needed.

P2:
- Evidence: another context's data. Level 2 is justified without a measurement.
- Projection `order_shipping_status` (schema.sql) with `processed_shipping_events` for idempotency. Trigger: outbox consumer. Idempotency key: outbox event id, plus a shipment-version guard so older events are ignored. Staleness bound: the projection is applied right after the shipping command commits; at worst the next `python3 -m src.process_projection` run.
- Read-your-own-writes: `main.create_shipment` and `main.dispatch_shipment` run the relay after commit and before returning, so the dispatch email cannot precede the row a customer reads.
- Shipping side: `shipments.version`, a `shipping_outbox` table (retry count, dead-letter flag), published contracts in `src/shipping/contracts.py` (`ShipmentCreated` v1 and `ShipmentDispatched` v1), outbox writes in the commands in the same transaction, and a relay in `src/shipping/adapters/relay.py` (at least once, ordered, 5 retries, then dead-letter with an ALERT log).
- Consumer: `src/projections/order_shipping.py`. Rebuild (`python3 -m src.rebuild_projection`) replays the outbox into an emptied projection and never reads `shipments`.
- `src/queries/my_orders.py` now joins `order_shipping_status`; nothing outside Shipping reads `shipments`.
- Tests: `tests/test_order_shipping_projection.py` covers read-your-own-writes, pending, redelivery, an older event after a newer one, rebuild equals incremental, rollback leaves no outbox row, and retry then dead-letter.
- Checks: check_direction.py passes; all 10 tests pass.

Not done:
- No real bus or alert channel exists. The dead-letter alert is a log line, and the relay is in-process.
- Scheduling of process_projection (cron) is not set up.
- The process and rebuild scripts were run against the test database, and PROJECTION.json was written.
