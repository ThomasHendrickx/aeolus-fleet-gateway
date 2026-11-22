Add an MCP tool `ship_order` so agents can ship an order. The shipping use case already exists and is served over REST (`POST /ship`).
Acceptance criteria:
- Given a paid order and a carrier, when the tool is called, then the order comes back shipped with that carrier.
- Given an unpaid order, when the tool is called, then the tool returns an error result and does not raise.
