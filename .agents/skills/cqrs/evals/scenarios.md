# cqrs scenarios

Run every scenario independently against a fresh fixture with both `SKILL.md` and `aip/`, with `harness.py` (see its docstring); results live in `results/`. A result is PASS, FAIL, or NOT RUN. A missing run is NOT RUN. Fixtures are real Python code on a real Postgres (`harness.py postgres` starts a container; each run gets its own database), with a task written as a person would; none names a problem number or the expected behaviour. A fixture is `fixtures/_shared` plus its own folder.

| ID | Kind | Fixture | Given / When / Then |
| --- | --- | --- | --- |
| S0.1 | script | `country` | Given plain CRUD on a country reference list, When P0 runs, Then applies is false and no file is added in paths.queries. |
| S0.2 | script | `violations` | Given a file in paths.queries importing the domain Order, When P0 runs, Then it is in violations. |
| S0.3 | script | `violations` | Given a command handler importing from paths.queries, When P0 runs, Then it is in violations. |
| S0.4 | agent | `totals` | Given a per-customer totals page built by loading every order, When P0 runs, Then problems includes 1. |
| S1.1 | script | `totals` | Given that totals page task, When P1 completes, Then a query handler in paths.queries returns a read type, imports nothing from paths.domain, and checks.queryTests passes. |
| S1.2 | agent | `totals` | Then paging, sort and totals are computed in SQL, not in code. |
| S1.3 | script | `totals` | Then no repository finder was added. |
| S1.4 | script | `edit-form` | Given an edit form for one order, When P1 completes, Then the query returns a read type (not the Order class) and no projection table exists. |
| S1.5 | agent | `loyalty` | Given a customer list that shows each customer's loyalty tier (gold above 10 orders unless suspended), When P1 completes, Then no query handler evaluates the tier rule; the tier is read from a field the write side persists. |
| S2.1 | script | `slow-totals` | Given a "totals page feels slow" task whose measurement is p95 40 ms, When P2 runs, Then it stops and no projection table exists. |
| S2.2 | script | `revenue` | Given monthly revenue computed from all invoices and a measurement over budget, When P2 completes, Then the query reads a projection, the same change applied twice gives the same rows, and a rebuild from source equals the incremental state. |
| S2.3 | agent | `revenue` | Then the projection declares its trigger, staleness bound, idempotency key and rebuild procedure, plus a read-your-own-writes strategy when async. |
| S2.4 | script | `shipping` | Given an async projection, When the command's transaction rolls back, Then no outbox row exists. |
| S3.1 | script | `finder` | Given a repository finder used by two display reads, one touched by the task, When P3 completes, Then the touched read uses a query, the untouched one is unchanged, and the finder still exists. |
| S4.1 | agent | `update-order` | Given an UpdateOrder(dto) handler that diffs fields, and a task letting customers change their shipping address, When P4 completes, Then a command named for the address change carries only address fields and returns id, outcome or version. |
| S4.2 | script | `update-order` | Then UpdateOrder still exists and its tests for the other fields pass. |

S0.1 is the intentional no-problem control. Every other fixture carries a real problem signal, so P0 does not stop the scenario before its procedure; `slow-totals` builds the page by loading every order (problem 1, so P0 applies), and its measurement is under budget, so P2 step 1 is what stops it. A scenario S1.x to S4.x whose run P0 stopped (applies not true) is NOT RUN, whatever its check says: its procedure never ran.

How the script checks work, beyond the obvious:

- S2.2 seeds invoices through the app's own commands, voids one, then voids it again; it applies pending updates (the `process` command from `PROJECTION.json`) once, then twice more, and compares the projection rows; then runs `rebuild` and compares again. The report must also show the expected months.
- S2.4 adds a deferred constraint trigger on `shipments` that refuses one shipment's commit, so the command's transaction rolls back after all its statements ran. No table may change; a committed dispatch must add a row to a table the fixture did not have (the outbox).
- S1.1, S1.4: a read type is a class the query module defines; the module must not import `paths.domain` (checked with the P0 scanner).
- S0.4 is read from the agent's `RESULT.json`; S1.2, S1.5, S2.3 and S4.1 are judged by a separate agent from the diff.
