# Report
- P0: scan_domain_imports.py on src/core for sqlite3 -> no violations. Problem 3 holds (REST and MCP need the same rules). applies=true. Wrote RESULT.json: {"violations": [], "problems": [3], "applies": true}.
- P2 step 1: the discount rules sat in the REST handler, so I ran P3 first. Existing REST tests served as the captured scenarios.
- P3: moved the rules to src/core/pricing.py (price_order, NegativeTotal). Reduced src/adapters/rest.py to translation only.
- P2: added src/adapters/mcp.py (price_order_tool, returns an error result and does not raise on a negative total). Wired it in src/main.py as MCP_TOOLS. Added tests/test_mcp.py for the three acceptance criteria.
- Checks (run_check.py): check_direction.py passed, 7 unit tests passed.
- Not done: no real MCP server runtime exists in the repo, so the tool is a registered function only.
