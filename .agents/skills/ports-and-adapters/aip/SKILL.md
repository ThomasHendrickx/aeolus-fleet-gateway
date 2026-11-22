---
name: ports-and-adapters
description: Use when business rules need infrastructure, test seams, multiple entry points, or a swappable external dependency. Keep domain use cases independent of transport and infrastructure.
metadata:
  aip:
    spec: https://github.com/zach-blumenfeld/aip/tree/v0.3a3
    schemaId: https://raw.githubusercontent.com/zach-blumenfeld/aip/v0.3a3/assets/aip-schemas/procedure.schema.json
---

```yaml
purpose: >
  Keep business rules independent of infrastructure and transport. The core owns ports,
  interfaces in domain language defined by what the core needs. Driven adapters implement
  outbound ports and the core never imports them. Tests run the core against in-memory adapters.
  Driving adapters (REST, MCP, CLI) translate input and call one inbound port. Dependencies point
  inward and wiring happens only in the composition root. Companion inputs: paths.domain,
  paths.ports, paths.adapters, paths.compositionRoot, checks.dependencyDirection (command),
  infraModules (packages that count as infrastructure). P0 is the entry node of every procedure;
  P1 adds an outbound port and driven adapter, P2 a driving adapter, P3 extracts a use case.
trigger_when:
  - "Problem 1: business rules call infrastructure directly (DB client, HTTP, SDK, queue). Signal: infra imports inside domain/use-case modules."
  - "Problem 2: testing a rule needs real infrastructure. Signal: use-case tests need a DB or network."
  - "Problem 3: one use case is reached through several entry points (REST, MCP, CLI, queue, cron). Signal: same logic duplicated across handlers."
  - "Problem 4: an external dependency will change or has alternatives (vendor, API version, store). Signal: a swap would touch business logic."
do_not_use_when:
  - "No business rules (pure CRUD or pass-through), one entry point, one store, no test pain. Then: no ports. Add them when a problem above appears."
scope_and_approval: >
  Rule 1: port signatures use domain types only; adapter types never cross the boundary.
  Rule 2: mapping between domain and external types happens inside the adapter.
  Rule 3: a port is shaped by one use case's need, not by the adapter's API.
  Rule 4: adapters hold no business rules.
  P3 applies only to code the task touches.
steps:
  - name: p0-1-scan-imports
    description: P0 step 1 (script). Scan paths.domain for imports from infraModules.
    script: scripts/scan_domain_imports.py
    inputs:
      - name: paths.domain
        type: string
        description: Domain directory from the repo companion.
      - name: infraModules
        type: list[string]
        description: Packages that count as infrastructure.
    outputs:
      - name: violations
        type: list[string]
        description: Domain files that import an infra module.
  - name: p0-2-check-problems
    description: P0 step 2 (agent). Check the task against problems 2-4; non-empty violations is problem 1.
    depends_on: [p0-1-scan-imports]
    inputs:
      - name: task
        type: object
        description: The task and its acceptance criteria.
      - name: violations
        type: list[string]
    outputs:
      - name: problems
        type: list[integer]
        description: Problem numbers (1-4) that hold.
  - name: p0-3-decide-applies
    description: P0 step 3 (agent). No problems -> stop, no ports. Otherwise applies is true.
    depends_on: [p0-2-check-problems]
    inputs:
      - name: problems
        type: list[integer]
    outputs:
      - name: applies
        type: boolean
        description: False means stop and create no port.
  - name: p1-1-name-need
    description: P1 step 1 (agent). Name the need in domain language per use case (rule 3).
    depends_on: [p0-3-decide-applies]
    inputs:
      - name: applies
        type: boolean
      - name: task
        type: object
    outputs:
      - name: port_spec
        type: object
        description: Port spec per use case, in domain language.
  - name: p1-2-define-port
    description: P1 step 2 (agent). Port interface in paths.ports, domain types only.
    depends_on: [p1-1-name-need]
    inputs:
      - name: port_spec
        type: object
      - name: paths.ports
        type: string
    outputs:
      - name: port_file
        type: string
  - name: p1-3-in-memory-adapter
    description: P1 step 3 (agent). In-memory adapter for the port.
    depends_on: [p1-2-define-port]
    inputs:
      - name: port_file
        type: string
      - name: paths.adapters
        type: string
    outputs:
      - name: fake_file
        type: string
  - name: p1-4-scenario-tests
    description: P1 step 4 (agent). Scenario tests from the acceptance criteria against the fake, before use case code. Rules - behaviour-driven-development skill.
    depends_on: [p1-3-in-memory-adapter]
    inputs:
      - name: task
        type: object
      - name: fake_file
        type: string
    outputs:
      - name: failing_tests
        type: list[string]
        description: Scenario tests that fail until the use case exists.
  - name: p1-5-implement-use-case
    description: P1 step 5 (agent). Implement the use case until the scenarios pass.
    depends_on: [p1-4-scenario-tests]
    inputs:
      - name: failing_tests
        type: list[string]
      - name: paths.domain
        type: string
    outputs:
      - name: use_case_file
        type: string
  - name: p1-6-real-adapter
    description: P1 step 6 (agent). Real adapter, mapping inside it (rule 2).
    depends_on: [p1-5-implement-use-case]
    inputs:
      - name: port_file
        type: string
      - name: paths.adapters
        type: string
    outputs:
      - name: adapter_file
        type: string
  - name: p1-7-wire
    description: P1 step 7 (agent). Wire in paths.compositionRoot.
    depends_on: [p1-6-real-adapter]
    inputs:
      - name: adapter_file
        type: string
      - name: paths.compositionRoot
        type: string
    outputs:
      - name: wired
        type: boolean
  - name: p1-8-check-direction
    description: P1 step 8 (script). Run checks.dependencyDirection.
    script: scripts/run_check.py
    depends_on: [p1-7-wire]
    inputs:
      - name: wired
        type: boolean
      - name: checks.dependencyDirection
        type: string
        description: Command declared by the repo companion.
    outputs:
      - name: direction_passed
        type: boolean
  - name: p2-1-find-inbound-port
    description: P2 step 1 (agent). Find the inbound port; if the logic sits in another handler, run P3 first.
    depends_on: [p0-3-decide-applies]
    inputs:
      - name: applies
        type: boolean
      - name: task
        type: object
      - name: paths.domain
        type: string
    outputs:
      - name: inbound_port
        type: string
  - name: p2-2-driving-adapter
    description: P2 step 2 (agent). Adapter translates input to a domain command, calls the port, maps results and errors to the transport.
    depends_on: [p2-1-find-inbound-port]
    inputs:
      - name: inbound_port
        type: string
      - name: paths.adapters
        type: string
    outputs:
      - name: driving_adapter_file
        type: string
  - name: p2-3-test-translation
    description: P2 step 3 (agent). Test only the translation.
    depends_on: [p2-2-driving-adapter]
    inputs:
      - name: driving_adapter_file
        type: string
    outputs:
      - name: translation_tests
        type: list[string]
  - name: p2-4-wire
    description: P2 step 4 (agent). Wire the adapter in paths.compositionRoot.
    depends_on: [p2-3-test-translation]
    inputs:
      - name: driving_adapter_file
        type: string
      - name: paths.compositionRoot
        type: string
    outputs:
      - name: driving_wired
        type: boolean
  - name: p2-5-check-direction
    description: P2 step 5 (script). Run checks.dependencyDirection.
    script: scripts/run_check.py
    depends_on: [p2-4-wire]
    inputs:
      - name: driving_wired
        type: boolean
      - name: checks.dependencyDirection
        type: string
    outputs:
      - name: driving_direction_passed
        type: boolean
  - name: p3-1-capture-scenarios
    description: P3 step 1 (agent). Touched code only. Capture current behaviour as scenarios.
    depends_on: [p0-3-decide-applies]
    inputs:
      - name: applies
        type: boolean
      - name: task
        type: object
    outputs:
      - name: captured_scenarios
        type: list[string]
  - name: p3-2-move-rules
    description: P3 step 2 (agent). Move the rules behind an inbound port in paths.domain.
    depends_on: [p3-1-capture-scenarios]
    inputs:
      - name: captured_scenarios
        type: list[string]
      - name: paths.domain
        type: string
    outputs:
      - name: extracted_port
        type: string
  - name: p3-3-reduce-handler
    description: P3 step 3 (agent). Reduce the handler to translation only.
    depends_on: [p3-2-move-rules]
    inputs:
      - name: extracted_port
        type: string
    outputs:
      - name: handler_file
        type: string
  - name: p3-4-check-direction-and-scenarios
    description: P3 step 4 (script). Run checks.dependencyDirection and the scenarios.
    script: scripts/run_check.py
    depends_on: [p3-3-reduce-handler]
    inputs:
      - name: handler_file
        type: string
      - name: checks.dependencyDirection
        type: string
      - name: captured_scenarios
        type: list[string]
    outputs:
      - name: extraction_passed
        type: boolean
anti_patterns:
  - "Failure mode 1: port mirrors the technology (runQuery, findByPrismaWhere)."
  - "Failure mode 2: one generic repository port per table instead of per need."
  - "Failure mode 3: ORM or SDK types (e.g. Prisma models) leaking into the domain."
  - "Failure mode 4: validation or business decisions inside a handler or adapter."
  - "Failure mode 5: ports added \"for later\" with no problem present."
```
