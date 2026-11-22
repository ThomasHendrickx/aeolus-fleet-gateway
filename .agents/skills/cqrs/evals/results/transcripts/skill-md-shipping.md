# Agent report

Steps: read SKILL.md and related/domain-events; P0 (no import violations; problem 3, another context's data; applies=true, RESULT.json written); P2 (evidence: another context's data, `measurement` none).

Changes:
- Shipping (`src/shipping`): shipments get a `version`; the aggregate records ShipmentCreated/ShipmentDispatched; commands write them to `shipping_outbox` in the same transaction; `contracts.py` declares the ShipmentChanged v1 integration event (state transfer declared); `relay.py` publishes after commit, at least once, retries, dead-letters after 5 attempts with an error-log alert.
- Orders context: `order_shipping` projection plus `order_shipping_processed_events` (idempotency key = event_id, older shipment_version ignored) in schema.sql and `src/projections/order_shipping.py`; `my_orders` query now reads `order_shipping`, no longer `shipments`.
- Projection spec: async outbox consumer; read-your-own-writes by running the relay synchronously right after the shipping commands commit (src/main.py), `process` retries failures; rebuild replays retained outbox events (`python3 -m src.projections.rebuild`).
- Tests: tests/test_order_shipping_projection.py. All 10 tests and check_direction pass.

Not done: no backfill for shipments that existed before the outbox (their status would show pending until a new event); no real email sender exists in the repo, so nothing was wired to it; dead-letter alert is an error log.
