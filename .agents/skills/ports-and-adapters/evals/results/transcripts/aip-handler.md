# Report

Steps: P0 (scan_domain_imports.py on src/core with sqlite3 -> no violations; task matches problem 3, because the cron job reuses the REST refund handler -> problems [3], applies true; RESULT.json written). P3 steps 1-4.

Changes:
- Added src/core/refunds.py: the inbound port `request_refund` holds the refund rules, including the new rule that an amount above 50000 cents gives pending_approval.
- src/adapters/rest_refunds.py now only translates: outcomes map to 422/409/202/200.
- Added tests/test_refunds.py. It covers 50001 -> 202 pending_approval, 50000 -> 200, and the existing outcomes.
- Checked with run_check.py: check_direction.py passed and all 7 tests passed.

Notes: cron_refunds.py is out of scope and untouched. It calls the handler, so nightly settlements above 50000 cents now return 202 as well. Other handlers were not touched. Nothing was left undone.
