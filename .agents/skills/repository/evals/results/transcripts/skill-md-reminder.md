# Report
- P0: ports import no sqlite3, so violations is empty. Problem 3 applies (the task needs a list read across customers), so applies is true. RESULT.json is written.
- P2: the read serves a command (it sends mail), so it is a repository finder, not a read model.
  - Added `find_overdue(today, PageRequest)` and `PageRequest` to the Orders port.
  - Implemented it in the in-memory and sqlite adapters. Each is need-named, takes a page request, and the database pages.
  - Added two contract cases that run against both adapters.
  - Added `send_reminders` in src/core/reminders.py. It pages through the overdue orders, groups them by customer, and sends one mail per customer with subject "Overdue orders". Added a test for it.
- Ran the contract tests (15 pass) and check_direction.py (ok).
- Not done: the existing `list_for_customer` has no page request. I left it alone because it is outside this task.
