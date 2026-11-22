# Report

P0: scan_port_types.py on src/core/ports with sqlite3 gave no violations. Problem 3 holds (find_by returns an unbounded list). Problem 4 is not established by the script. applies = true. RESULT.json written: {"violations": [], "problems": [3], "applies": true}.

P3: scope was only the find_by call in send_reminders (src/core/reminders.py). The find_by call in draft_cleanup.py is untouched, so find_by stays and the generic method was not removed.
Changes:
- Added src/core/paging.py (PageRequest).
- Added the need-named finder find_placed_due_before(due_before, page) to the Orders port, the in-memory adapter and the sqlite adapter. It returns only status "placed" orders, and sqlite applies LIMIT/OFFSET.
- send_reminders now uses that finder and pages through all results.
- Added contract tests (skips paid and draft; paging) and tightened the callers test so paid orders are not reminded.
Checks: check_direction.py and the unittest suite (16 tests) pass via run_check.py.
Nothing I could not do.
