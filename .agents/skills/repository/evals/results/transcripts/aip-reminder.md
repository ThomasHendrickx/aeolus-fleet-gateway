# Report
- P0: scan_port_types.py found no violations (no sqlite3 in ports). Problem 3 holds (the task needs a list read across customers and list methods have no page request). Result: {"violations": [], "problems": [3], "applies": true}, written to repo/RESULT.json.
- P2: the read serves a command (send mails), so a repository finder fits. Added PageRequest (src/core/orders.py), port method list_overdue_unpaid(today, page) (placed orders due before today, ordered by customer, due, number), implemented in the in-memory and sqlite adapters (LIMIT/OFFSET in SQL), and added contract cases to tests/test_orders_contract.py (filter/order and paging, both adapters).
- Added send_reminders(orders, notifier, today) in src/core/reminders.py (pages through, one mail per customer, subject "Overdue orders", body = order numbers) with tests/test_reminders.py (incl. customer spanning pages).
- P2 step 5: run_check.py on contract tests and direction check: both pass (16 tests).
- Not done: P1 and P3 were not requested.
