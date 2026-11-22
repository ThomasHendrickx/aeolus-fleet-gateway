# Report
- P0: core has no prismalike imports (violations []); problems 2 and 4 apply (use case needs a store, swappable); applies true. Wrote RESULT.json first. No scan script exists in the skill folder, so I scanned by grep.
- P1: port OrderSummarySource (src/core/ports), use case order_summary in src/core/orders.py, in-memory adapter, scenario tests (tests/test_order_summary.py), PrismaOrders adapter mapping cents/status inside, wired in src/main.py, ran check_direction.py (direction ok) and unittest (pass).
- Deviation: tests were written together with the use case in one pass, not strictly failing-first.
