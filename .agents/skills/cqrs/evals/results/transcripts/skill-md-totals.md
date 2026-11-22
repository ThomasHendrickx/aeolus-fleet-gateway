# Report

Steps run:
- P0: no script exists in the skill folder, so I checked imports by hand (grep). `src/queries` was empty and no command handler imports queries, so violations is empty. Problems 1 and 3 apply: the page loads every order and counts and sums in code, across customers and orders. applies is true. Written to repo/RESULT.json.
- P1: wrote the query spec and the failing integration tests on real Postgres (empty, cancelled excluded, multi-line order, min_orders filter, count, next page, tie order). Wrote the query handler `src/queries/customer_totals.py` (SQL with grouping, HAVING filter, sort, LIMIT/OFFSET and a separate count). Rewired `customer_totals_page` in `src/web/staff_pages.py` to it. The page now also returns `total`.
- Ran `python3 check_direction.py` (direction ok) and the unittest discover command (9 tests OK).

Decisions: the order total is a plain sum of line quantity times price, computed in SQL. No total is persisted today and I made no schema change. `list_all` finders were left in place because other callers may use them. Customers with no non-cancelled orders still do not appear, as before.
