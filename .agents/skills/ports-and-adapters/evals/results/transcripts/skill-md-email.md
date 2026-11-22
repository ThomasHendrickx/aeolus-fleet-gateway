# Report
- P0: no infra imports in src/core (violations none); problems 2 and 4 (vendor SDK does network calls); applies true. Written to repo/RESULT.json.
- P1: port src/core/ports/mailer.py (OverdueReminders); in-memory adapter; scenario tests (tests/test_remind_overdue.py) written first and seen failing; remind_overdue added in src/core/invoices.py; real adapter src/adapters/vendor_mailer.py (subject mapping inside); wired in src/main.py; check_direction.py passes, 4 tests pass.
- Not done: nothing skipped. P0 script step was done by manual inspection plus check_direction.py (skill has no scripts).
