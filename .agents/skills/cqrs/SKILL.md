---
name: cqrs
description: Use when a read's shape differs from the write model (lists, counts, rollups, another context's data), a read misses its budget, or a whole-object save hides user intent.
---

# Problem

Matters when one or more holds:

1. A read's shape differs from the write model (joins, counts, rollups across aggregates). Signals: a read loads aggregates and assembles, filters or counts in code; repository read methods with paging or sorting; getters or eager loads added only to build a response.
2. A read computes from history on the request path, or a measured read misses its budget.
3. A read spans aggregates in this bounded context, or needs another context's data.
4. The write model bends to serve reads. Signal: fields or relationships no invariant uses.
5. Commands lose user intent. Signal: a whole-object save whose handler diffs fields.

# Solution

- Commands are named for intent, run through use cases and repositories, and return an id, outcome or version. (4, 5)
- Queries: one query port per need returning read types; the handler reads the tables directly with SQL, paging, filters, sort and counts in the query (`performance`). (1, 3)
- Derived business values are computed and persisted by the write side; queries only read them. (1, 4)
- Another context's data comes from a local projection fed by its published events, never from its tables. (3)
- A projection only when level 1 misses budget, reads history, or needs another context. (2, 3)
- Same database by default. (1-3)

# Levels

0. Plain CRUD: one simple model.
1. Query side over the same tables. Default once the skill applies.
2. Projection tables in the same database: measured need, history read, or another context's data.
3. Separate read store: out of scope; needs an explicit architecture decision.
4. Event sourcing: out of scope.

# Not needed when

Plain CRUD on supporting data with no shape mismatch. An edit form reading one aggregate's own fields needs no projection: it is a level-1 query returning a read type.

# Rules

1. A query never changes state. A command returns ack, id, outcome or version, never a view. Creates may use client-generated ids.
2. Query ports return read types; no aggregates, ORM entities or query builders.
3. One query per need, selecting only the fields its caller uses. No generic query layer.
4. The query side never imports the domain model and never evaluates a business rule; it may read the same tables.
5. Start at level 1. Level 2 needs a recorded measurement over budget, a history read, or another context's data. Level 3 needs an explicit architecture decision.
6. A projection declares its update trigger (same transaction, outbox consumer or scheduled snapshot), staleness bound, idempotency key and rebuild procedure. An async projection also declares its read-your-own-writes strategy.
7. Events feeding a projection follow `domain-events`.
8. Commands are named for business intent and carry only the data that behaviour needs. CRUD verbs only for supporting data.
9. A command handler never reads a projection or query to decide.
10. Applied per read need inside one bounded context, never mandated system-wide. A mediator library is optional and is not CQRS. Event sourcing is never introduced here.

# Failure modes

1. Separate database, bus or event sourcing for a CRUD screen; CQRS or a mediator mandated system-wide.
2. Display reads as repository finders loading aggregates.
3. Aggregates or ORM entities returned to an API.
4. A command returning the updated view.
5. A business rule evaluated in a query handler.
6. A generic query layer (query builder, filter DSL) behind the port.
7. Dual write: commit, then publish without an outbox.
8. A projection without a rebuild path, or one that double-counts on redelivery.
9. An async projection with no read-your-own-writes: the user does not see their own change.
10. A command handler deciding on read-model data.
11. `Update<Entity>(dto)` commands where real intents exist.
12. Cross-context SQL joins presented as a read model.

# Procedures

Companion inputs: `paths.domain`, `paths.queries`, `paths.compositionRoot`, `checks.dependencyDirection`, `infraModules`, `checks.queryTests` (integration tests against a real Postgres), `measurement` (latest staging performance run; an input, not a step).

## P0 Applicability gate (entry)

1. script: parse `paths.queries` for imports from `paths.domain`, and command handlers for imports from `paths.queries` -> `violations[]` (rules 4, 9).
2. agent: check the task for problems 1-5 -> `problems[]`.
3. agent: no problems -> stop, plain CRUD; else -> `applies`.

## P1 Add a query (level 1)

1. agent: name the need; read type with only the fields the caller uses -> query spec.
2. agent: a field needing a business rule -> persisted by the write side (`domain-modelling`); another context's data -> P2.
3. agent: integration scenarios on real Postgres from the acceptance criteria: shape, empty, filter, sort, count, next page -> failing tests.
4. agent: query handler in `paths.queries`, SQL with paging, filters, sort and counts in the query.
5. agent: wire the driving adapter to the query port.
6. script: run `checks.dependencyDirection` and `checks.queryTests`.

## P2 Add a projection (level 2)

1. agent: evidence = `measurement` over budget, a history read, or another context's data; none -> stop at level 1.
2. agent: projection table shaped for the query; declare trigger, staleness bound, idempotency key, rebuild procedure, and for async a read-your-own-writes strategy -> projection spec.
3. agent: scenarios: given changes -> expected rows; the same change applied twice -> no double update; rebuild from source equals incremental.
4. agent: async trigger -> event written to the outbox in the command's transaction.
5. agent: idempotent updater on the trigger.
6. agent: rebuild command.
7. agent: switch the query handler to the projection.
8. script: run `checks.dependencyDirection` and `checks.queryTests`.

## P3 Move a display read off the repository

1. agent: scope = the display reads the task touches; every other caller stays unchanged -> scope list.
2. agent: replace each with a query through P1.
3. agent: remove a finder only when no caller is left.
4. script: run `checks.dependencyDirection` and `checks.queryTests`.

## P4 Split a whole-object save into intent commands

1. agent: scope = the intents the task touches; other fields keep the current path -> scope list.
2. agent: one command per intent, named for it, carrying only its data, returning id, outcome or version.
3. agent: scenarios per command from the acceptance criteria -> failing tests.
4. agent: implement through the use case and repository.
5. script: run `checks.dependencyDirection` and the tests.
