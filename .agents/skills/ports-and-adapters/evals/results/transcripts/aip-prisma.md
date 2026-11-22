# Report
P0: scan found no violations; problem 2 holds (the order store needs a DB to test). applies=true. RESULT.json written.
P1: named the need (OrderSource.order_by_id), port in src/core/ports/orders.py, in-memory adapter, scenario tests, use case src/core/summary.py, Prisma adapter (maps cents/status inside), wired in src/main.py, direction check and tests passed (5 tests OK).
Not done: P2/P3 (not requested). Scenario tests were written together with the fake rather than observed failing first.
