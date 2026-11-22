# Report

Steps run
- P0-1: ran scripts/scan_query_imports.py src/core src/queries -> violations: [] (src/queries is empty; no rule 4/9 breaks).
- P0-2: customer_totals_page loads every order and customer aggregate through the unit of work, then filters (cancelled, min_orders), sums, sorts and pages in Python. That is problem 1 (read shape differs from the write model; assembled/filtered/paged in code) and problem 3 (spans the customer and order aggregates). Problems 2, 4, 5 not shown: history is not read, the write model is not bent, no commands involved.
- P0-3: applies = true. RESULT.json written: {"violations": [], "problems": [1, 3], "applies": true}.
- P2-1: checked projection evidence. MEASUREMENT.md (staging, 2026-11-03, production-sized data): p95 40 ms and 46 ms against a 300 ms budget, so no measurement over budget. No history read. No other context's data (customers and orders are in this context). Evidence: none -> stop at level 1 (rule 5).
- P2-2 onward not run: no projection added, so no PROJECTION.json.

Changed
- Only RESULT.json and this report. No code changed, no projection or table added.

Could not do / notes
- Not asked to run P1, so the level-1 fix (a query handler in src/queries issuing one SQL aggregate with paging, filter and sort, wired from the web page) was not implemented. It is the right next step, not a projection. The measured numbers are within budget, so the "slow" claim is not backed by the staging run.
