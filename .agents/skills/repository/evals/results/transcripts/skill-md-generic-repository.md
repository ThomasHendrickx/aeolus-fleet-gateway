# Report

P0: no script is shipped with the skill, so I checked the ports by hand. No port uses an infra (sqlite3) type, so violations is empty. Problem 3 applies because find_by returns an unpaged list. Result: {"violations": [], "problems": [3], "applies": true}, written to repo/RESULT.json.

P3:
1. Scope: the one generic call the task touches is find_by in send_reminders. The call in draft_cleanup.py is outside the task and is unchanged.
2. Replaced it through P2. The read serves a command, so it is a repository finder. Added `find_overdue_unpaid(today, page)` and a `PageRequest` type. It matches placed orders due before today (drafts and paid orders are excluded), ordered by due date then number, with paging done in SQL. It is implemented in both adapters. `send_reminders` now pages through it.
3. Added two contract cases that run against both adapters (exclusion rules and paging). Tightened the caller test so a paid order is not reminded.
4. Kept `find_by` on the port and adapters because draft_cleanup still calls it.
5. Ran `python3 -m unittest discover -s tests -t .` (16 tests OK) and `python3 check_direction.py` (direction ok).

Not done: nothing skipped.
