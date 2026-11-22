---
name: ports-and-adapters
description: Use when business rules need infrastructure, test seams, multiple entry points, or a swappable external dependency. Keep domain use cases independent of transport and infrastructure.
---

# Problem

Matters when one or more holds:
1. Business rules call infrastructure directly (DB client, HTTP, SDK, queue). Signal: infra imports inside domain/use-case modules.
2. Testing a rule needs real infrastructure. Signal: use-case tests need a DB or network.
3. One use case is reached through several entry points (REST, MCP, CLI, queue, cron). Signal: same logic duplicated across handlers.
4. An external dependency will change or has alternatives (vendor, API version, store). Signal: a swap would touch business logic.

# Solution

- Core owns ports: interfaces in domain language, defined by what the core needs. (1, 4)
- Driven adapters implement outbound ports; core never imports them. (1, 4)
- Tests run the core against in-memory adapters. (2)
- Driving adapters (REST, MCP, CLI) translate input and call one inbound port. (3)
- Dependencies point inward; wiring happens only in the composition root. (1-4)

# Not needed when

No business rules (pure CRUD or pass-through), one entry point, one store, no test pain. Then: no ports. Add them when a problem above appears.

# Rules

1. Port signatures use domain types only; adapter types never cross the boundary.
2. Mapping between domain and external types happens inside the adapter.
3. A port is shaped by one use case's need, not by the adapter's API.
4. Adapters hold no business rules.

# Failure modes

1. Port mirrors the technology (`runQuery`, `findByPrismaWhere`).
2. One generic repository port per table instead of per need.
3. ORM or SDK types (e.g. Prisma models) leaking into the domain.
4. Validation or business decisions inside a handler or adapter.
5. Ports added "for later" with no problem present.

# Procedures

Inputs from the repo companion skill: `paths.domain`, `paths.ports`, `paths.adapters`, `paths.compositionRoot`; `checks.dependencyDirection` (command); `infraModules` (packages that count as infrastructure).

## P0 Applicability gate

Entry node of every procedure.
1. script: scan `paths.domain` for imports from `infraModules` -> `violations[]`.
2. agent: check the task against problems 2-4; non-empty `violations` is problem 1 -> `problems[]`.
3. agent: no problems -> stop, no ports. Otherwise -> `applies: bool`.

## P1 Outbound port + driven adapter

1. agent: name the need in domain language per use case (rule 3) -> port spec.
2. agent: port interface in `paths.ports`, domain types only.
3. agent: in-memory adapter.
4. agent: scenario tests from the acceptance criteria against the fake, before use case code (rules: `behaviour-driven-development`) -> failing tests.
5. agent: implement the use case until the scenarios pass.
6. agent: real adapter, mapping inside it (rule 2).
7. agent: wire in `paths.compositionRoot`.
8. script: run `checks.dependencyDirection`.

## P2 Driving adapter for an existing use case

1. agent: find the inbound port; if the logic sits in another handler, run P3 first.
2. agent: adapter translates input to a domain command, calls the port, maps results and errors to the transport.
3. agent: test only the translation.
4. agent: wire.
5. script: run `checks.dependencyDirection`.

## P3 Extract a use case from a handler/adapter

Touched code only.
1. agent: capture current behaviour as scenarios.
2. agent: move the rules behind an inbound port in `paths.domain`.
3. agent: reduce the handler to translation only.
4. script: run `checks.dependencyDirection` and the scenarios.

# Scenarios

[evals/scenarios.md](evals/scenarios.md): run against this form and `aip/`.
