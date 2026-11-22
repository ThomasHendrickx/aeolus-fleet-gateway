P0 report
- Read SKILL.md, TASK.md, COMPANION.md.
- P0-1: ran scripts/scan_port_types.py src/core/ports sqlite3 -> violations: [].
- P0-2: task is single-table CRUD on tags (id + name), no list, no multi-row invariant -> no problems 1-4.
- P0-3: no problems hold, so applies = false (do_not_use_when: single-table CRUD).
- Wrote repo/RESULT.json: {"violations": [], "problems": [], "applies": false}. No other changes; stopped after P0.
