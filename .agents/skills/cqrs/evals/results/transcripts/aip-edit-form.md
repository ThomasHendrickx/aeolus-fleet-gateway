# Report
- P0: scan_query_imports.py -> no violations. Problems 1, 3, 4 hold (display read joins customers and loads the aggregate; spans aggregates; Order carries customer_email/to_form only for the screen). applies=true. Written to repo/RESULT.json.
- P1: query need = order edit form. Added src/queries/order_edit_form.py (OrderEditForm read type + SQL handler, own OrderNotFound, no domain imports). Wired via src/main.py order_edit_form; src/web/staff_pages.py now calls it (same dict keys).
- Removed customer_email and to_form from Order and the customers join from PgOrderRepository.get.
- Added a shape/not-found scenario to tests/test_order_edit_form.py (existing test kept).
- P1 step 6: run_check.py with check_direction.py and unittest: all passed.
- Not done: P2-P4 (not needed: no measurement, no history/foreign context, no command changes).
