---
name: cqrs
description: Use when a read's shape differs from the write model (lists, counts, rollups, another context's data), a read misses its budget, or a whole-object save hides user intent.
metadata:
  aip:
    spec: https://github.com/zach-blumenfeld/aip/tree/v0.3a3
    schemaId: https://raw.githubusercontent.com/zach-blumenfeld/aip/v0.3a3/assets/aip-schemas/procedure.schema.json
---

```yaml
purpose: >
  Commands are named for intent, run through use cases and repositories, and return an id, outcome
  or version (problems 4, 5). Queries: one query port per need returning read types; the handler
  reads the tables directly with SQL, paging, filters, sort and counts in the query (performance)
  (problems 1, 3). Derived business values are computed and persisted by the write side; queries
  only read them (problems 1, 4). Another context's data comes from a local projection fed by its
  published events, never from its tables (problem 3). A projection only when level 1 misses
  budget, reads history, or needs another context (problems 2, 3). Same database by default
  (problems 1-3). Companion inputs are paths.domain, paths.queries, paths.compositionRoot,
  checks.dependencyDirection, infraModules, checks.queryTests (integration tests against a real
  Postgres) and measurement (latest staging performance run; an input, not a step).
trigger_when:
  - "Problem 1: a read's shape differs from the write model (joins, counts, rollups across aggregates). Signals: a read loads aggregates and assembles, filters or counts in code; repository read methods with paging or sorting; getters or eager loads added only to build a response."
  - "Problem 2: a read computes from history on the request path, or a measured read misses its budget."
  - "Problem 3: a read spans aggregates in this bounded context, or needs another context's data."
  - "Problem 4: the write model bends to serve reads. Signal: fields or relationships no invariant uses."
  - "Problem 5: commands lose user intent. Signal: a whole-object save whose handler diffs fields."
do_not_use_when:
  - "Plain CRUD on supporting data with no shape mismatch."
  - "An edit form reading one aggregate's own fields needs no projection: it is a level-1 query returning a read type."
modes:
  - name: level-0
    body: "Plain CRUD: one simple model."
  - name: level-1
    body: "Query side over the same tables. Default once the skill applies."
  - name: level-2
    body: "Projection tables in the same database: measured need, history read, or another context's data."
  - name: level-3
    body: "Separate read store: out of scope; needs an explicit architecture decision."
  - name: level-4
    body: "Event sourcing: out of scope."
scope_and_approval: >
  Rule 1: a query never changes state. A command returns ack, id, outcome or version, never a view.
  Creates may use client-generated ids. Rule 2: query ports return read types; no aggregates, ORM
  entities or query builders. Rule 3: one query per need, selecting only the fields its caller uses.
  No generic query layer. Rule 4: the query side never imports the domain model and never evaluates
  a business rule; it may read the same tables. Rule 5: start at level 1. Level 2 needs a recorded
  measurement over budget, a history read, or another context's data. Level 3 needs an explicit
  architecture decision. Rule 6: a projection declares its update trigger (same transaction, outbox
  consumer or scheduled snapshot), staleness bound, idempotency key and rebuild procedure. An async
  projection also declares its read-your-own-writes strategy. Rule 7: events feeding a projection
  follow domain-events. Rule 8: commands are named for business intent and carry only the data that
  behaviour needs. CRUD verbs only for supporting data. Rule 9: a command handler never reads a
  projection or query to decide. Rule 10:
  applied per read need inside one bounded context, never mandated system-wide. A mediator library
  is optional and is not CQRS. Event sourcing is never introduced here.
anti_patterns:
  - "Separate database, bus or event sourcing for a CRUD screen; CQRS or a mediator mandated system-wide."
  - "Display reads as repository finders loading aggregates."
  - "Aggregates or ORM entities returned to an API."
  - "A command returning the updated view."
  - "A business rule evaluated in a query handler."
  - "A generic query layer (query builder, filter DSL) behind the port."
  - "Dual write: commit, then publish without an outbox."
  - "A projection without a rebuild path, or one that double-counts on redelivery."
  - "An async projection with no read-your-own-writes: the user does not see their own change."
  - "A command handler deciding on read-model data."
  - "Update<Entity>(dto) commands where real intents exist."
  - "Cross-context SQL joins presented as a read model."
steps:
  - name: p0-1-scan-query-imports
    description: P0 step 1 (script). Parse paths.queries for imports from paths.domain, and command handlers (modules under paths.domain) for imports from paths.queries (rules 4, 9).
    script: scripts/scan_query_imports.py
    inputs:
      - {name: paths.domain, type: string, description: "Domain model and use cases, from the companion."}
      - {name: paths.queries, type: string, description: "Query side, from the companion."}
    outputs:
      - {name: violations, type: "list[object]", description: "Files breaking rule 4 or 9, each with path, imports and rule."}
  - name: p0-2-check-problems
    description: P0 step 2 (agent). Check the task for problems 1-5.
    depends_on: [p0-1-scan-query-imports]
    inputs:
      - {name: task, type: object, description: Task and acceptance criteria.}
      - {name: violations, type: "list[object]"}
    outputs:
      - {name: problems, type: "list[integer]", description: Problem numbers 1-5 that hold.}
  - name: p0-3-decide-applies
    description: P0 step 3 (agent). No problems -> stop, plain CRUD; else applies.
    depends_on: [p0-2-check-problems]
    inputs:
      - {name: problems, type: "list[integer]"}
    outputs:
      - {name: applies, type: boolean}
  - name: p1-1-name-query-need
    description: P1 step 1 (agent). Name the need; read type with only the fields the caller uses.
    depends_on: [p0-3-decide-applies]
    inputs:
      - {name: applies, type: boolean}
      - {name: task, type: object}
    outputs:
      - {name: query_spec, type: object, description: The need and its read type.}
  - name: p1-2-route-derived-and-foreign-fields
    description: P1 step 2 (agent). A field needing a business rule is persisted by the write side (domain-modelling); another context's data goes to P2.
    depends_on: [p1-1-name-query-need]
    inputs:
      - {name: query_spec, type: object}
      - {name: paths.domain, type: string}
    outputs:
      - {name: routed_query_spec, type: object, description: Query spec with rule-derived fields read from write-side columns.}
  - name: p1-3-write-query-scenarios
    description: "P1 step 3 (agent). Integration scenarios on real Postgres from the acceptance criteria: shape, empty, filter, sort, count, next page."
    depends_on: [p1-2-route-derived-and-foreign-fields]
    inputs:
      - {name: routed_query_spec, type: object}
      - {name: task, type: object}
    outputs:
      - {name: failing_query_tests, type: "list[string]"}
  - name: p1-4-query-handler
    description: P1 step 4 (agent). Query handler in paths.queries, SQL with paging, filters, sort and counts in the query.
    depends_on: [p1-3-write-query-scenarios]
    inputs:
      - {name: failing_query_tests, type: "list[string]"}
      - {name: paths.queries, type: string}
    outputs:
      - {name: query_handler, type: string}
  - name: p1-5-wire-driving-adapter
    description: P1 step 5 (agent). Wire the driving adapter to the query port.
    depends_on: [p1-4-query-handler]
    inputs:
      - {name: query_handler, type: string}
      - {name: paths.compositionRoot, type: string}
    outputs:
      - {name: query_wired, type: boolean}
  - name: p1-6-run-direction-and-query-tests
    description: P1 step 6 (script). Run checks.dependencyDirection and checks.queryTests.
    script: scripts/run_check.py
    depends_on: [p1-5-wire-driving-adapter]
    inputs:
      - {name: query_wired, type: boolean}
      - {name: checks.dependencyDirection, type: string}
      - {name: checks.queryTests, type: string}
    outputs:
      - {name: p1_checks_passed, type: boolean}
  - name: p2-1-check-projection-evidence
    description: P2 step 1 (agent). Evidence is measurement over budget, a history read, or another context's data; none -> stop at level 1.
    depends_on: [p0-3-decide-applies]
    inputs:
      - {name: applies, type: boolean}
      - {name: task, type: object}
      - {name: measurement, type: string, description: "Latest staging performance run, from the companion."}
    outputs:
      - {name: projection_evidence, type: object, description: Which evidence holds; none means stop at level 1.}
  - name: p2-2-specify-projection
    description: P2 step 2 (agent). Projection table shaped for the query; declare trigger, staleness bound, idempotency key, rebuild procedure, and for async a read-your-own-writes strategy.
    depends_on: [p2-1-check-projection-evidence]
    inputs:
      - {name: projection_evidence, type: object}
    outputs:
      - {name: projection_spec, type: object, description: "Table, trigger, staleness bound, idempotency key, rebuild procedure, and for async the read-your-own-writes strategy, each declared with the projection (rule 6)."}
  - name: p2-3-write-projection-scenarios
    description: "P2 step 3 (agent). Scenarios: given changes -> expected rows; the same change applied twice -> no double update; rebuild from source equals incremental."
    depends_on: [p2-2-specify-projection]
    inputs:
      - {name: projection_spec, type: object}
    outputs:
      - {name: failing_projection_tests, type: "list[string]"}
  - name: p2-4-outbox-for-async-trigger
    description: P2 step 4 (agent). Async trigger -> event written to the outbox in the command's transaction.
    depends_on: [p2-3-write-projection-scenarios]
    inputs:
      - {name: failing_projection_tests, type: "list[string]"}
      - {name: projection_spec, type: object}
    outputs:
      - {name: outbox_write, type: string, description: "Where the command writes its event, or none for a same-transaction trigger."}
  - name: p2-5-idempotent-updater
    description: P2 step 5 (agent). Idempotent updater on the trigger.
    depends_on: [p2-4-outbox-for-async-trigger]
    inputs:
      - {name: outbox_write, type: string}
    outputs:
      - {name: projection_updater, type: string}
  - name: p2-6-rebuild-command
    description: P2 step 6 (agent). Rebuild command.
    depends_on: [p2-5-idempotent-updater]
    inputs:
      - {name: projection_updater, type: string}
    outputs:
      - {name: rebuild_command, type: string}
  - name: p2-7-switch-query-to-projection
    description: P2 step 7 (agent). Switch the query handler to the projection.
    depends_on: [p2-6-rebuild-command]
    inputs:
      - {name: rebuild_command, type: string}
      - {name: paths.queries, type: string}
    outputs:
      - {name: projection_query_switched, type: boolean}
  - name: p2-8-run-direction-and-query-tests
    description: P2 step 8 (script). Run checks.dependencyDirection and checks.queryTests.
    script: scripts/run_check.py
    depends_on: [p2-7-switch-query-to-projection]
    inputs:
      - {name: projection_query_switched, type: boolean}
      - {name: checks.dependencyDirection, type: string}
      - {name: checks.queryTests, type: string}
    outputs:
      - {name: p2_checks_passed, type: boolean}
  - name: p3-1-scope-touched-display-reads
    description: P3 step 1 (agent). Scope is the display reads the task touches; every other caller stays unchanged.
    depends_on: [p0-3-decide-applies]
    inputs:
      - {name: applies, type: boolean}
      - {name: task, type: object}
    outputs:
      - {name: display_read_scope, type: "list[string]", description: Display reads in scope; every other caller stays unchanged.}
  - name: p3-2-replace-with-queries
    description: P3 step 2 (agent). Replace each display read in scope with a query through P1.
    depends_on: [p3-1-scope-touched-display-reads]
    inputs:
      - {name: display_read_scope, type: "list[string]"}
    outputs:
      - {name: replaced_display_reads, type: "list[string]"}
  - name: p3-3-remove-unused-finder
    description: P3 step 3 (agent). Remove a finder only when no caller is left.
    depends_on: [p3-2-replace-with-queries]
    inputs:
      - {name: replaced_display_reads, type: "list[string]"}
    outputs:
      - {name: finders_removed, type: "list[string]"}
  - name: p3-4-run-direction-and-query-tests
    description: P3 step 4 (script). Run checks.dependencyDirection and checks.queryTests.
    script: scripts/run_check.py
    depends_on: [p3-3-remove-unused-finder]
    inputs:
      - {name: finders_removed, type: "list[string]"}
      - {name: checks.dependencyDirection, type: string}
      - {name: checks.queryTests, type: string}
    outputs:
      - {name: p3_checks_passed, type: boolean}
  - name: p4-1-scope-touched-intents
    description: P4 step 1 (agent). Scope is the intents the task touches; other fields keep the current path.
    depends_on: [p0-3-decide-applies]
    inputs:
      - {name: applies, type: boolean}
      - {name: task, type: object}
    outputs:
      - {name: intent_scope, type: "list[string]", description: Intents in scope; other fields keep the current path.}
  - name: p4-2-define-intent-commands
    description: P4 step 2 (agent). One command per intent, named for it, carrying only its data, returning id, outcome or version.
    depends_on: [p4-1-scope-touched-intents]
    inputs:
      - {name: intent_scope, type: "list[string]"}
    outputs:
      - {name: intent_commands, type: "list[object]"}
  - name: p4-3-write-command-scenarios
    description: P4 step 3 (agent). Scenarios per command from the acceptance criteria.
    depends_on: [p4-2-define-intent-commands]
    inputs:
      - {name: intent_commands, type: "list[object]"}
      - {name: task, type: object}
    outputs:
      - {name: failing_command_tests, type: "list[string]"}
  - name: p4-4-implement-commands
    description: P4 step 4 (agent). Implement through the use case and repository.
    depends_on: [p4-3-write-command-scenarios]
    inputs:
      - {name: failing_command_tests, type: "list[string]"}
      - {name: paths.domain, type: string}
    outputs:
      - {name: commands_implemented, type: boolean}
  - name: p4-5-run-direction-and-tests
    description: P4 step 5 (script). Run checks.dependencyDirection and the tests.
    script: scripts/run_check.py
    depends_on: [p4-4-implement-commands]
    inputs:
      - {name: commands_implemented, type: boolean}
      - {name: checks.dependencyDirection, type: string}
      - {name: checks.queryTests, type: string, description: "The repo's test command, which also runs the command scenarios."}
    outputs:
      - {name: p4_checks_passed, type: boolean}
```
