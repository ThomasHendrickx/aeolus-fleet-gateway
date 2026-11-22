# Report

P0 (script step done by hand; no script in the skill folder): src/queries has no imports from src/core; no command handler imports src/queries. violations=[]. Problems 1 (list loads aggregates and counts in code) and 2 (tier computed from order history on the request path) hold. applies=true. Written to repo/RESULT.json.

P1:
- Query spec: `customer_list(page)` returns a page of (customer_id, name, email, tier) plus total; 25 per page, ordered by name, id.
- Tier is a business rule, so the write side persists it: `customers.counted_orders` and `customers.loyalty_tier` (schema.sql, with a backfill and indexes). `Customer` recomputes the tier through `loyalty_tier()` on order placed, order cancelled, suspend and reinstate. The place_order and cancel_order commands update the customer in the same transaction. `get` on the customer repository now locks the row (FOR UPDATE) so concurrent order changes do not lose counts.
- New `src/queries/customer_list.py` reads the tables directly with SQL (LIMIT/OFFSET, count); it imports no domain code. `src/web/staff_pages.customer_list` now calls it (response gains `total`).
- Tests added in tests/test_customer_list.py (empty, paging, sort, count, tier on place/cancel/suspend/reinstate) on real Postgres.
- Ran `python3 check_direction.py` (direction ok) and `python3 -m unittest discover -s tests -t .` (5 tests OK).

Not done: no projection (level 1 only, no measurement). Old repository finders (list_all, list_for_customer) left in place; not removed as P3 was not requested.
