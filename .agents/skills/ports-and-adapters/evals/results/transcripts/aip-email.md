# Report
- P0: scan found no violations. Problems 2 and 4 hold (the vendor SDK makes a network call; the vendor can change). applies=true. Wrote RESULT.json: {"violations": [], "problems": [2, 4], "applies": true}.
- P1: port ReminderMailer (src/core/ports/mailer.py); in-memory adapter (src/adapters/fake_mailer.py); scenario tests in tests/test_invoices.py; use case remind_overdue in src/core/invoices.py; real adapter EmailSdkMailer (src/adapters/email_sdk_mailer.py) holding the subject mapping; wired in src/main.py (build_mailer).
- Checks: run_check.py with the direction check and the unittest scenarios passed (5 tests).
- Not done: none. Tests were written together with the fake, then the use case; I did not separately observe them failing first.
