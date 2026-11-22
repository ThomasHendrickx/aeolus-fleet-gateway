# Ports-and-adapters scenarios

One set serves the SKILL.md eval and the AIP functional tests. Run with `harness.py` (see its docstring); results live in `results/`.

Kinds: `script` is an executable check on a fixture repository after the procedure ran; `agent` is judged by a fresh agent from the repository state. Both kinds are produced by an agent working through the form under test.

| ID | Kind | Fixture | Given / When / Then |
| --- | --- | --- | --- |
| S0.1 | script | `crud` | Given a CRUD endpoint task with no rules, one entry point, one store, When P0 runs, Then `applies` is false and no port file is created. |
| S0.2 | script | `violation` | Given a file in `paths.domain` importing a module in `infraModules`, When P0 runs, Then that file is in `violations` and `applies` is true with problem 1. |
| S0.3 | agent | `mcp` | Given a task adding an MCP tool for a use case already served over REST, When P0 runs, Then `problems` includes problem 3. |
| S1.1 | script | `email` | Given a use case that must send email, When P1 completes, Then the port in `paths.ports` imports nothing from `infraModules`, an in-memory adapter exists, and the scenario tests pass against it. |
| S1.2 | script | `email` | Then the real adapter is the only file importing the email SDK. |
| S1.3 | agent | `prisma` | Given the external API returns its own type (e.g. a Prisma model), When P1 completes, Then the port returns a domain type and the mapping lives in the adapter. |
| S1.4 | script | `email` | Then `checks.dependencyDirection` passes. |
| S2.1 | agent | `rest` | Given a REST handler holding a business rule, When P2 adds an MCP adapter for the same use case, Then the rule exists once, in the use case, and both adapters call the same inbound port. |
| S2.2 | agent | `rest` | Then the new adapter's tests cover input translation and error mapping only. |
| S3.1 | script | `handler` | Given a handler holding business rules, When P3 completes, Then the scenarios captured in step 1 still pass and the handler imports only the inbound port. |
| S3.2 | agent | `handler` | Then the handler contains no business decision. |
| S3.3 | script | `handler` | Given other handlers with the same smell that the task did not touch, When P3 completes, Then those files are unchanged. |

How each is decided: S0.x, S1.1, S1.2, S1.4, S3.1, S3.3 by `harness.py` checks; S1.3, S2.1, S2.2, S3.2 by a judge agent that reads the final repository and the harness evidence. S0.3 is the agent's `RESULT.json`, checked by the harness.
