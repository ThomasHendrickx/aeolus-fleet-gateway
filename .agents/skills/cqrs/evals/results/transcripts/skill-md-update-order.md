# Report

- P0: queries dir has no imports from domain and no command imports queries -> violations []. Task is problem 5 (whole-object save, intent lost via UpdateOrder) -> applies true. Wrote repo/RESULT.json.
- P4: scope = the shipping-address intent only; UpdateOrder and put_order left unchanged for note/lines.
  - Tests first (tests/test_change_shipping_address.py, 4 scenarios: change + version, other fields untouched, shipped rejected, cancelled rejected); confirmed failing before implementation.
  - Added Order.change_shipping_address (rule in the domain: only while placed), command src/core/commands/change_shipping_address.py (returns version), wired in src/main.py, customer handler post_shipping_address in src/web/order_pages.py.
  - check_direction.py: ok. Full test suite: 9 tests OK.
- Not done: none. Cancelled orders are also blocked (task only specified shipped; "until it ships" read as placed-only).
