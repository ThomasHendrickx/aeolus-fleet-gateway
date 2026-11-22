# Repository scenarios

Run every scenario independently against a fresh fixture with both `SKILL.md` and `aip/`, with `harness.py` (see its docstring); results live in `results/`. A result is PASS, FAIL, or NOT RUN. A missing run is NOT RUN. Fixtures are real code with a real task written as a person would; none names a problem number or the expected behaviour.

| ID | Kind | Fixture | Given / When / Then |
| --- | --- | --- | --- |
| S0.1 | script | `single-table` | Given a single-table CRUD task, When P0 runs, Then applies is false and no repository port exists. |
| S0.2 | script | `orm-leak` | Given a port whose method takes an ORM type, When P0 runs, Then that port is in violations and problems includes 4. |
| S1.1 | script | `order` | Given an Order aggregate with lines and the invariant "total equals the sum of lines", When P1 completes, Then one repository port exists for Order and none for OrderLine. |
| S1.2 | script | `order` | Then the contract suite, including a duplicate order number case, passes on both adapters. |
| S1.3 | agent | `order` | Then the real adapter's list method pages in the query, not after reading rows. |
| S1.4 | agent | `order` | Then no repository method commits or opens a transaction. |
| S2.1 | agent | `dashboard` | Given a task for a per-customer totals dashboard, When P2 runs, Then no finder is added and the work is routed to a read model. |
| S2.2 | script | `reminder` | Given a reminder command needing overdue orders, When P2 completes, Then the port has a need-named finder (no findBy/where) and its contract cases pass on both adapters. |
| S3.1 | script | `generic-repository` | Given findBy(where) used by two callers, one touched by the task, When P3 completes, Then the touched caller uses a need-named finder, the untouched one is unchanged, and findBy still exists. |

S0.1 is the intentional no-problem control. Every other fixture has a genuine P0 problem signal, so P0 does not stop the scenario before its procedure.
