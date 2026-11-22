# Report
- P0: no imports from src/core in src/queries (empty), none from queries in command handlers: violations []. Problems 1, 3, 4 hold (form joins customers, spans aggregates, Order carries customer_email/to_form only for the screen). applies = true. Written to repo/RESULT.json.
- P1: query spec = order edit form (number, status, street, city, postcode, note, customer_email). Wrote tests first (shape, field set, correct order/customer, unknown order), added src/queries/order_edit_form.py (direct SQL, no domain imports), wired src/web/staff_pages.py to it, removed customer_email and to_form from Order and the customers join from PgOrderRepository.get.
- Ran check_direction.py (ok) and unittest (6 tests OK).
- Notes: the skill's P0 "script" does not exist in the skill folder, so I did the import scan by grep. The query raises its own OrderEditFormNotFound since the query side may not import the domain's OrderNotFound. No level-2 projection (no measurement, no history).
