---
name: behaviour-driven-development
description: Use for every code change. Tests come from the approved scenarios and the repo's guarantees, built red-green-refactor, outside in.
---

# Behaviour-driven development

A test proves a scenario someone approved or a guarantee the repo states. Nothing else gets a test.

Where tests come from:
- Scenarios: the acceptance criteria as Given/When/Then, in the approved design or the issue. A bug's scenario is its reproduction.
- Guarantees: listed in the repo's testing companion skill.
- Non-functionals are scenarios with a number: how big, who may, what when it fails, what the limits are.
- Behaviour you must build has no scenario: ask the sender of your task. Never write and test your own.

Loop per scenario, outside in:
1. Red: the scenario as one test at the outer edge, named as the scenario, its Given, When and Then as three blocks. See it fail for the right reason. Commit `test(<scope>): <scenario> (red)` with only the test.
2. Green: least code to pass, run it by name. Commit `feat(<scope>): <scenario>` (or `fix`).
3. Refactor with tests green, in the green commit or as `refactor(<scope>): ...` right after it.
No code before its scenario's test is clear. That is the order of the work, not of the commits: never rewrite git history. Push green heads only.

Layers:
- The outer edge first: the use case for domain behaviour, the API for who may, a real database in a container for adapters and for scale and failure scenarios.
- End to end (few, critical journeys): act via `data-testid="{area}-{element}"`, assert via role or text with a retrying assertion. Wait on what the app does (a known response, or the part's `data-state`), never on a sleep or `networkidle`.
- Each journey runs against a production build, never a dev server, seeds its own data, fakes outside services, starts once the app answers its readiness check, fakes the clock, reduces motion and asserts end state, never a duration, ms budget or animation timing.
- CI retries an e2e test once with a trace; one that passes only on retry is flaky: fix it, never set its retries to 0.
- An inner unit test only for a rule the edge cannot reach cheaply; its name says which scenario it serves.
- Fakes are hand-written and only for system boundaries (database, network, clock, ids, vendors). Assert outcomes and stored state, not calls. Inputs from named factories (`aShip(...)`); inject clock and ids.
- Expected values come from the scenario or a worked example, never recomputed the way the code computes them.

Not a test: plumbing, types, constants, wiring, or a check that breaks on a refactor without a behaviour change.

Done: every scenario and guarantee passes by name in the output; typecheck and lint green; no test without a scenario or guarantee behind it.
