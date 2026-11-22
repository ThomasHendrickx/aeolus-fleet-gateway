# Report

P0: ports dir had no infra types, so violations = []. Problems 1 (order and lines saved in pieces) and 2 (no cross-adapter tests) found; 3 not yet (no list method existed). applies = true. Written to repo/RESULT.json.

P1: 
- Aggregate: Order (root) with Line children; total derived from lines.
- Port: src/core/ports/order_repository.py (get, save, find_by_customer_latest_due_first with PageRequest; DuplicateOrderNumber, OrderNotFound).
- Contract tests: tests/order_repository_contract.py, run by tests/test_order_repository.py against both adapters. Replaced the old test_place_order.py (its case is now in the contract).
- Adapters: src/adapters/in_memory_orders.py, src/adapters/sqlite_orders.py (paging in SQL, no commit).
- place_order now takes (uow, orders, ...) and saves via the repository inside the uow; main.py wired.
- Ran contract tests (12 OK) and check_direction.py (direction ok).

Notes: the customer-order list returns full Order aggregates (with lines); a pure display list would belong in a read model (cqrs), not done. Nothing left undone.
