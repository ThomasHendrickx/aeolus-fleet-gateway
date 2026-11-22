# Scenario results

One run per scenario group and form, by fresh Sonnet 5.5 subagents (`claude-sonnet-5-5`) following the form under test; judged scenarios by a separate Sonnet 5.5 judge per form. Reports and diffs: `transcripts/`. Raw table: `check-output.md`.

| Scenario | SKILL.md | AIP | notes (SKILL.md / AIP) |
| --- | --- | --- | --- |
| S0.1 | PASS | PASS | applies=False port files=[] / applies=False port files=[] |
| S0.2 | PASS | PASS | violations=['src/core/orders.py'] applies=True problems=[1] / violations=['src/core/orders.py'] applies=True problems=[1, 2] |
| S0.3 | PASS | PASS | applies=True problems=[3] / applies=True problems=[3] |
| S1.1 | PASS | PASS | ports=['mailer.py'] port_infra_imports=[] in-memory=[('src/adapters/in_memory_mailer.py', 'InMemoryOverdueReminders')] new/changed tests using fake=['test_remind_overdue.py'] tests_exit=0 / ports=['mailer.py'] port_infra_imports=[] in-memory=[('src/adapters/fake_mailer.py', 'InMemoryMailer')] new/changed tests using fake=['test_invoices.py'] tests_exit=0 |
| S1.2 | PASS | PASS | importers of email_sdk=['adapters/vendor_mailer.py'] / importers of email_sdk=['adapters/email_sdk_mailer.py'] |
| S1.3 | PASS | PASS | core/ports/__init__.py returns the domain Order and the OrderModel-to-Order mapping (cents/100, status code to OrderStatus) lives only in adapters/prisma_orders.py. / src/core/ports/orders.py returns the domain Order and the OrderModel-to-Order mapping (cents to Decimal, status code to OrderStatus) lives only in src/adapters/prisma_orders.py; core/summary.py just d |
| S1.4 | PASS | PASS | direction ok / direction ok |
| S2.1 | PASS | PASS | The 10000 threshold and VIP rule exist only in core/pricing.py price_order, which both adapters/rest.py and adapters/mcp.py call. / The 10000 threshold and VIP rule appear only in src/core/pricing.py price_order, and both src/adapters/rest.py and src/adapters/mcp.py just translate and call it. |
| S2.2 | FAIL | FAIL | tests/test_mcp.py asserts discounted totals (9000 and 8500 for the 10% and VIP rules), so it tests the business arithmetic, not only translation and error mapping. / tests/test_mcp.py test_big_order_discount and test_vip_coupon assert discount arithmetic (9000, 8500 cents), which is the business rule, not only translation and error mapping. |
| S3.1 | PASS | PASS | handler project imports=['src.core.refunds'] new refund tests=['test_refunds.py'] tests_exit=0 / handler project imports=['src.core'] new refund tests=['test_refunds.py'] tests_exit=0 |
| S3.2 | PASS | PASS | adapters/rest_refunds.py only builds the command, calls request_refund and maps reasons and statuses to HTTP codes; the window, amount and threshold comparisons are in core/refunds.py. / src/adapters/rest_refunds.py has no threshold, window or amount comparisons; it calls refunds.request_refund and maps outcome.kind to HTTP statuses, with the rules in src/core/refunds.py. |
| S3.3 | PASS | PASS | unchanged={'src/adapters/rest_users.py': True, 'src/adapters/rest_invoices.py': True, 'tests/test_users_invoices.py': True} / unchanged={'src/adapters/rest_users.py': True, 'src/adapters/rest_invoices.py': True, 'tests/test_users_invoices.py': True} |


## Notes

- S2.2 FAIL in both forms: the MCP adapter tests assert the discounted totals (9000, 8500). The task's acceptance criteria were written as those totals, so the agents tested them through the adapter; the skill's P2 step 3 ("test only the translation") did not stop it.
- Handler fixture, round 1 (`transcripts/*-handler-round1.*`): both forms stopped at P0 with `applies` false (one REST entry point, no infra), so P3 never ran. That follows the gate as designed; the fixture had no problem signal. The fixture was then given a second entry point (a cron job calling the handler, problem 3) and rerun; S3.x results are from that rerun. Round 1 is kept as a finding: P3 on a lone handler with rules is blocked by the P0 gate.
- Some agents wrote scenario tests together with the code instead of failing first (P1 step 4): skill-md prisma, aip email, aip prisma, both handler runs said so in their reports. Not scored by any scenario.
- A first run of the S1.1 check counted only new test files and failed the AIP form, which had edited an existing test file; the check was corrected to count new or changed files and rerun on the same repositories.
- S0.2 AIP also reported problem 2; the scenario requires problem 1 present, so it passes.
- One run per cell: a pass is a single observation, not a rate.
