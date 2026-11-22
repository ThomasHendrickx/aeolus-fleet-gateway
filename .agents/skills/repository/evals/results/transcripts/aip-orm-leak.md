# P0 report
- Read SKILL.md, TASK.md, COMPANION.md.
- p0-1: ran scripts/scan_port_types.py src/core/ports miniorm sqlite3 (first try passed modules as one quoted string and found nothing; reran with separate args). Violation: src/core/ports/orders.py (search takes miniorm.Query).
- p0-2: problem 4 (script). Problem 2: only a sqlite adapter test, no suite against in-memory and real. Problem 3: Orders.search returns list with no page request, and the task adds another list read. Problem 1: no evidence.
- p0-3: applies = true.
- Wrote repo/RESULT.json: {"violations": ["src/core/ports/orders.py"], "problems": [2,3,4], "applies": true}. No other files changed; stopped after P0.
