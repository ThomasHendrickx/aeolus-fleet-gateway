# Report
Ran P0 only. Step 1 (script step, done by hand-scan with grep of imports): found 2 violations, in src/queries/order_summary.py (imports src.core.orders.OrderLine) and src/core/commands/cancel_order.py (imports src.queries.order_summary). Step 2: problem 1 holds (summary card loads lines and computes the total in code); problems 2-5 do not. Step 3: applies = true.
Changed: wrote repo/RESULT.json only. No code written. Nothing could not be done.
