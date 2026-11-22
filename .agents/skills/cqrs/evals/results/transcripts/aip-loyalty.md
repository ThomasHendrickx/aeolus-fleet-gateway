# Agent report (cqrs skill, loyalty list)

P0: scan_query_imports.py found no violations. Problems 1 and 3 hold (the list loads every customer and each customer's orders and counts in code). Applies is true. Written to repo/RESULT.json.

P1 (level 1, same database):
- Need: staff customer list, read type CustomerListPage/CustomerListRow (customer_id, name, email, tier).
- The tier is a business rule, so the write side persists it: new customers.loyalty_tier column (schema.sql, with a backfill), refreshed by `refresh_loyalty_tier` (src/core/commands/loyalty_tier.py) in the same transaction on place_order, cancel_order, suspend_customer and reinstate_customer. The customer row is locked FOR UPDATE to avoid races. Rule stays in src/core/loyalty.py.
- Query handler src/queries/customer_list.py: plain SQL, ORDER BY name, id, LIMIT/OFFSET 25, plus total count. It imports no domain code. Wired via src/main.py and src/web/staff_pages.py. Added indexes on customers(name, id) and orders(customer_id).
- Tests added in tests/test_customer_list.py (shape, empty, sort, count, next page, tier after place/cancel/suspend/reinstate).
- P3: removed the finders list_all and list_for_customer, which no longer had callers.
- Checks: direction check and the unittest suite pass (run_check.py).

Not done: P2 (no measurement, history read or foreign context data; level 1 is enough). The list response gained a "total" key. The existing-data backfill sits in schema.sql; a real deployment needs it as a migration.
