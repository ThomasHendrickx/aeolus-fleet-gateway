# Report
- P0: scan_query_imports.py found no violations. Problem 5 holds (UpdateOrder is a whole-object save whose handler diffs fields). applies = true. Written to repo/RESULT.json.
- P4: scope = intent "change shipping address"; update_order and the staff edit path are unchanged.
  - Added command `change_shipping_address` (src/core/commands/change_shipping_address.py) carrying order id, street, city, postcode; returns the new version.
  - Rule lives on the aggregate: `Order.change_shipping_address` raises OrderError unless status is "placed" (src/core/orders.py).
  - Wired in src/main.py and a customer order-page handler `post_shipping_address` in src/web/order_pages.py.
  - Scenarios in tests/test_change_shipping_address.py (placed changes and version bumps; shipped rejected; other fields untouched).
- Checks: check_direction.py and the unit tests (8) pass via run_check.py.
- Not done: nothing skipped.
