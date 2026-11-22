# Scenario results

One run per fixture and form, by fresh Sonnet 5.5 subagents (`claude-sonnet-5-5`) following the form under test (`SKILL.md`, or `aip/` with its scripts), driven by `../harness.py` the way the ports-and-adapters pilot was. Script scenarios are executable checks run by the harness on the finished repositories. S1.3, S1.4 and S2.1 are agent scenarios: one separate Sonnet 5.5 judge per form read the final repositories (`judge-skill-md.json`, `judge-aip.json`). A pass is a single observation, not a rate.

Evidence per run is in `transcripts/<form>-<run>.{prompt.md,md,diff}`: the exact prompt, the agent's own report and the repository diff. `check-output.md` is the raw `harness.py check` output, `results.json` the table as data. The compiler validation (`validate-aip.txt`, real `validate.py` output), the count check (`check-aip.txt`) and the scanner unit test (`scan-unit-test.txt`) are separate real runs.

| Scenario | SKILL.md | AIP | notes (SKILL.md / AIP) |
| --- | --- | --- | --- |
| S0.1 | PASS | PASS | applies=false, no files added / same |
| S0.2 | PASS | PASS | `src/core/ports/orders.py` in violations, problems 3, 4 / same, problems 2, 3, 4 |
| S1.1 | PASS | PASS | one `OrderRepository` port, no line port / same |
| S1.2 | PASS | PASS | contract suite incl. duplicate order number passes on in-memory and sqlite / same |
| S1.3 | PASS | PASS | sqlite list method uses `LIMIT ? OFFSET ?` / same |
| S1.4 | PASS | PASS | only the unit of work commits / same |
| S2.1 | PASS | PASS | no finder added; `customer_totals` added as a standalone read path in `src/adapters/customer_totals.py` / same |
| S2.2 | PASS | PASS | `find_overdue(today, PageRequest)` / `list_overdue_unpaid(today, page)`, cases pass on both adapters |
| S3.1 | PASS | PASS | touched caller calls=['find_overdue_unpaid'] new port methods=['find_overdue_unpaid'] untouched unchanged=True find_by still in port and adapters=True tests exit=0 / touched caller calls=['find_placed_due_before'] new port methods=['find_placed_due_before'] untouched unchanged=True find_by still in port and adapters=True tests exit=0 |

## Notes

- S3.1 was rerun on both forms after P3 gained step 1 (scope = the generic calls the task touches); both fresh Sonnet 5.5 runs kept `draft_cleanup.py` and `find_by`. The result comes from `s3_1` in `../harness.py` run on the finished repositories; the other rows are from the earlier runs.
- S0.2: the SKILL.md agent also reported problem 3; the AIP agent reported 2, 3 and 4. The scenario requires 4 present, so both pass.
- S1.2 AIP: the harness counted `PlaceOrderTest` as a class that ran a duplicate-number case besides the two adapter classes; the in-memory and sqlite classes are both present, so the verdict stands.
- Neither form of the `order` run built a read model for the staff list (both said so in their reports); the list returns whole orders. Not scored.
- The `cqrs` skill the spec points to does not exist yet, so S2.1 "routed to a read model" was judged as a read path separate from the repository.
- Harness checks for S2.2 name a need-named finder by a word list (overdue, due, late, unpaid, remind) and reject generic names; that is a heuristic of the harness, not of the spec.
