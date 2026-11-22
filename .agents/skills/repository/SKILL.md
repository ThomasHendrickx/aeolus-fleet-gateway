---
name: repository
description: Use when an aggregate needs durable loading or saving, a need-named finder, or a replacement for generic repository calls.
---

# Problem

Matters when one or more holds:

1. An aggregate is loaded or saved in pieces, so invariants can break between calls. Signal: one use case writes several tables of one aggregate.
2. In-memory and real adapters behave differently (uniqueness, ordering, not-found, paging). Signal: no test suite runs against both.
3. Reads grow unbounded. Signal: a list method with no page request.
4. Query shape leaks through the port. Signal: a port parameter typed with an ORM type or a generic criteria object.

# Solution

- One repository per aggregate root: get by id, save the whole aggregate, finders named per need. (1, 4)
- Save joins the use case's unit of work; the repository never commits. (1)
- One contract test suite runs against the in-memory and the real adapter. (2)
- Every list method takes a page request; the database pages (`performance`). (3)
- Display and report reads go to a read model (`cqrs`), not the repository. (3, 4)

# Not needed when

No invariant spans rows (single-table CRUD): no repository; `ports-and-adapters` decides if a port is needed at all.

# Rules

1. Repositories exist only for aggregate roots; children load and save through their root.
2. Methods take and return domain types and ids; no ORM types, query builders or criteria objects.
3. A finder is named for the need (`findOverdue`), never generic (`findBy(where)`).
4. Every list method takes a page request.
5. The repository never commits or opens a transaction.
6. The in-memory adapter passes the same contract tests as the real one.

# Failure modes

1. Generic base repository (`Repository<T>`, `findAll`, `findBy`).
2. `findAll` followed by filtering in code.
3. A repository per table, children included.
4. Business decisions inside a repository method (`approveIfValid`).
5. An in-memory fake that skips uniqueness, ordering or not-found, so tests lie.
6. Dashboard or report reads added as repository finders.

# Procedures

Companion inputs: `paths.domain`, `paths.ports`, `paths.adapters`, `paths.compositionRoot`; `checks.dependencyDirection`; `infraModules`; plus `checks.contractTests` (command running the contract suite against both adapters).

## P0 Applicability gate

1. script: parse ports in `paths.ports` for parameter or return types from `infraModules` -> `violations[]` (problem 4).
2. agent: check task for problems 1-3 -> `problems[]`.
3. agent: no problems -> stop; else -> `applies`.

## P1 New repository for an aggregate

1. agent: name the root and its invariants -> aggregate spec.
2. agent: port per rules 1-4.
3. agent: contract tests from the acceptance criteria, parametrised by adapter -> failing tests.
4. agent: in-memory adapter until the contract passes.
5. agent: real adapter until the same contract passes, paging in the query, mapping inside.
6. agent: wire; the use case owns the unit of work (rule 5).
7. script: run `checks.contractTests` and `checks.dependencyDirection`.

## P2 Add a finder

1. agent: read serves a command (needs the aggregate) or a display? Display -> read model (`cqrs`), stop.
2. agent: need-named method, page request if a list.
3. agent: contract cases.
4. agent: implement in both adapters.
5. script: run `checks.contractTests`.

## P3 Replace a generic repository

1. agent: scope = the generic calls the task touches; every other caller stays unchanged -> scope list.
2. agent: list the generic calls the task touches.
3. agent: replace each with a need-named finder through P2.
4. agent: remove a generic method only when no caller is left.
5. script: run `checks.contractTests` and `checks.dependencyDirection`.
