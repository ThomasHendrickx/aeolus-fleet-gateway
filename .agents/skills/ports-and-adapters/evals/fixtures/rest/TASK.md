Add an MCP tool `price_order` that prices an order exactly like `POST /price` (same discount rules).
Acceptance criteria:
- Given items worth 10000 cents and no coupon, when the tool is called, then total_cents is 9000.
- Given items worth 10000 cents and coupon `VIP1`, when the tool is called, then total_cents is 8500.
- Given a negative total, when the tool is called, then the tool returns an error result and does not raise.
