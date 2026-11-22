# Report

Steps run:
- P0 step 1: scan_query_imports.py src/core src/queries -> no violations.
- P0 step 2/3: problem 1 holds (the page loads whole aggregates through a repository finder to build a list). Problems 2-5 do not. applies = true. Written to repo/RESULT.json.
- P3: scope was only `my_orders_page`. `customer_panel` (staff) is untouched and still uses `find_recent_for_customer`, so the finder stays (P3 step 3: nothing removed).
- P1 (via P3 step 2): the read type carries only number, placed_on, status and total. The total is a derived value, so the write side now persists it: new `orders.total_cents` column in schema.sql, written by `PgOrderRepository.save`. The query only reads it.
- Wrote tests first (tests/test_customer_orders.py: shape, empty, sort and ownership, first page with more, next page, exactly 10 shows no more, status change visible; plus a show-more test in test_pages.py).
- Added src/queries/customer_orders.py: SQL with LIMIT/OFFSET, order and count in the query. It imports nothing from src.core. Wired through src/main.py, and `my_orders_page(customer_id, page=1)` now returns rows, page, total and show_more.
- P3 step 4: check_direction.py passed and all 12 tests passed. The scan still shows no violations.

Not done: no backfill of total_cents for existing production rows (the fixture rebuilds its schema from schema.sql); a real migration would need one.
