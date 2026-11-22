Add a rule to `src/core/orders.py`: an order above 50000 cents is rejected (`pay` returns false) without charging.
Acceptance criteria:
- Given an order of 50001 cents, when it is paid, then it is rejected and nothing is charged.
- Given an order of 50000 cents, when it is paid, then it is charged.
