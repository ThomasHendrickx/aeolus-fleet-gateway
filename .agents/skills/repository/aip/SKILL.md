---
name: repository
description: Use when an aggregate needs durable loading or saving, a need-named finder, or a replacement for generic repository calls.
metadata:
  aip:
    spec: https://github.com/zach-blumenfeld/aip/tree/v0.3a3
    schemaId: https://raw.githubusercontent.com/zach-blumenfeld/aip/v0.3a3/assets/aip-schemas/procedure.schema.json
---

```yaml
purpose: >
  One repository serves one aggregate root: load by id, save the whole aggregate, and provide
  need-named finders. The repository joins the use case unit of work and never commits. Contract
  tests run against in-memory and real adapters. Every list has a page request and the database
  pages. Display and report reads use a cqrs read model. Companion inputs are paths.domain,
  paths.ports, paths.adapters, paths.compositionRoot, checks.dependencyDirection, infraModules,
  and checks.contractTests.
trigger_when:
  - "Problem 1: an aggregate is loaded or saved in pieces, so invariants can break between calls. Signal: one use case writes several tables of one aggregate."
  - "Problem 2: in-memory and real adapters behave differently. Signal: no test suite runs against both."
  - "Problem 3: reads grow unbounded. Signal: a list method with no page request."
  - "Problem 4: query shape leaks through the port. Signal: a port parameter typed with an ORM type or a generic criteria object."
do_not_use_when:
  - "No invariant spans rows (single-table CRUD): no repository; ports-and-adapters decides if a port is needed at all."
scope_and_approval: >
  Rule 1: repositories exist only for aggregate roots; children load and save through their root.
  Rule 2: methods take and return domain types and ids; no ORM types, query builders or criteria objects.
  Rule 3: a finder is named for the need, never generic. Rule 4: every list method takes a page request.
  Rule 5: the repository never commits or opens a transaction. Rule 6: the in-memory adapter passes
  the same contract tests as the real one. P3 applies only to touched code.
anti_patterns:
  - "Generic base repository (Repository<T>, findAll, findBy)."
  - "findAll followed by filtering in code."
  - "A repository per table, children included."
  - "Business decisions inside a repository method."
  - "An in-memory fake that skips uniqueness, ordering or not-found."
  - "Dashboard or report reads added as repository finders."
steps:
  - name: p0-1-scan-port-types
    description: P0 step 1 (script). Parse ports for parameter or return types from infraModules (problem 4).
    script: scripts/scan_port_types.py
    inputs:
      - {name: paths.ports, type: string, description: Port directory from the companion.}
      - {name: infraModules, type: "list[string]", description: Infrastructure modules from the companion.}
    outputs:
      - {name: violations, type: "list[string]", description: Ports whose annotations leak infrastructure.}
  - name: p0-2-check-problems
    description: P0 step 2 (agent). Check the task for problems 1-3; violations establishes problem 4.
    depends_on: [p0-1-scan-port-types]
    inputs:
      - {name: task, type: object, description: Task and acceptance criteria.}
      - {name: violations, type: "list[string]"}
    outputs:
      - {name: problems, type: "list[integer]", description: Problem numbers 1-4 that hold.}
  - name: p0-3-decide-applies
    description: P0 step 3 (agent). Stop when no problems hold; otherwise set applies true.
    depends_on: [p0-2-check-problems]
    inputs:
      - {name: problems, type: "list[integer]"}
    outputs:
      - {name: applies, type: boolean}
  - name: p1-1-name-root-and-invariants
    description: P1 step 1 (agent). Name the aggregate root and its invariants.
    depends_on: [p0-3-decide-applies]
    inputs:
      - {name: applies, type: boolean}
      - {name: task, type: object, description: Task and acceptance criteria.}
    outputs:
      - {name: aggregate_spec, type: object, description: Root and invariants.}
  - name: p1-2-define-port
    description: P1 step 2 (agent). Define the port per rules 1-4.
    depends_on: [p1-1-name-root-and-invariants]
    inputs:
      - {name: aggregate_spec, type: object}
      - {name: paths.ports, type: string}
    outputs:
      - {name: repository_port, type: string}
  - name: p1-3-write-contract-tests
    description: P1 step 3 (agent). Write adapter-parametrised contract tests from acceptance criteria before implementation.
    depends_on: [p1-2-define-port]
    inputs:
      - {name: repository_port, type: string}
      - {name: task, type: object}
    outputs:
      - {name: failing_contract_tests, type: "list[string]"}
  - name: p1-4-in-memory-adapter
    description: P1 step 4 (agent). Implement the in-memory adapter until the contract passes.
    depends_on: [p1-3-write-contract-tests]
    inputs:
      - {name: failing_contract_tests, type: "list[string]"}
      - {name: paths.adapters, type: string}
    outputs:
      - {name: memory_adapter, type: string}
  - name: p1-5-real-adapter
    description: P1 step 5 (agent). Implement the real adapter so the same contract passes; page in the query and map inside.
    depends_on: [p1-4-in-memory-adapter]
    inputs:
      - {name: memory_adapter, type: string}
      - {name: paths.adapters, type: string}
    outputs:
      - {name: real_adapter, type: string}
  - name: p1-6-wire-unit-of-work
    description: P1 step 6 (agent). Wire the adapters; the use case owns the unit of work (rule 5).
    depends_on: [p1-5-real-adapter]
    inputs:
      - {name: real_adapter, type: string}
      - {name: paths.compositionRoot, type: string}
    outputs:
      - {name: repository_wired, type: boolean}
  - name: p1-7-run-contract-and-direction
    description: P1 step 7 (script). Run contract tests and dependency-direction checks.
    script: scripts/run_check.py
    depends_on: [p1-6-wire-unit-of-work]
    inputs:
      - {name: repository_wired, type: boolean}
      - {name: checks.contractTests, type: string}
      - {name: checks.dependencyDirection, type: string}
    outputs:
      - {name: p1_checks_passed, type: boolean}
  - name: p2-1-classify-read
    description: P2 step 1 (agent). Decide whether the read serves a command or display; route display to cqrs read model and stop.
    depends_on: [p0-3-decide-applies]
    inputs:
      - {name: applies, type: boolean}
      - {name: task, type: object}
      - {name: paths.ports, type: string}
    outputs:
      - {name: read_kind, type: string, description: command or display.}
  - name: p2-2-name-finder
    description: P2 step 2 (agent). Add a need-named method and a page request for a list.
    depends_on: [p2-1-classify-read]
    inputs:
      - {name: read_kind, type: string}
    outputs:
      - {name: finder_spec, type: object}
  - name: p2-3-add-contract-cases
    description: P2 step 3 (agent). Add contract cases.
    depends_on: [p2-2-name-finder]
    inputs:
      - {name: finder_spec, type: object}
    outputs:
      - {name: finder_contract_cases, type: "list[string]"}
  - name: p2-4-implement-finder
    description: P2 step 4 (agent). Implement the finder in both adapters.
    depends_on: [p2-3-add-contract-cases]
    inputs:
      - {name: finder_contract_cases, type: "list[string]"}
      - {name: paths.adapters, type: string}
    outputs:
      - {name: finder_implemented, type: boolean}
  - name: p2-5-run-contract-tests
    description: P2 step 5 (script). Run the contract tests.
    script: scripts/run_check.py
    depends_on: [p2-4-implement-finder]
    inputs:
      - {name: finder_implemented, type: boolean}
      - {name: checks.contractTests, type: string}
    outputs:
      - {name: p2_contract_passed, type: boolean}
  - name: p3-1-scope-touched-calls
    description: P3 step 1 (agent). Scope is the generic calls the task touches; every other caller stays unchanged.
    depends_on: [p0-3-decide-applies]
    inputs:
      - {name: applies, type: boolean}
      - {name: task, type: object}
    outputs:
      - {name: scope_list, type: "list[string]", description: Generic calls in scope; every other caller stays unchanged.}
  - name: p3-2-list-touched-generic-calls
    description: P3 step 2 (agent). List the generic calls the task touches.
    depends_on: [p3-1-scope-touched-calls]
    inputs:
      - {name: scope_list, type: "list[string]"}
      - {name: task, type: object}
    outputs:
      - {name: touched_generic_calls, type: "list[string]"}
  - name: p3-3-replace-with-named-finders
    description: P3 step 3 (agent). Replace each call with a need-named finder through P2.
    depends_on: [p3-2-list-touched-generic-calls]
    inputs:
      - {name: touched_generic_calls, type: "list[string]"}
    outputs:
      - {name: replaced_calls, type: "list[string]"}
  - name: p3-4-remove-unreferenced-generic-method
    description: P3 step 4 (agent). Remove a generic method only when no caller remains.
    depends_on: [p3-3-replace-with-named-finders]
    inputs:
      - {name: replaced_calls, type: "list[string]"}
    outputs:
      - {name: generic_method_removed, type: boolean}
  - name: p3-5-run-contract-and-direction
    description: P3 step 5 (script). Run contract tests and dependency-direction checks.
    script: scripts/run_check.py
    depends_on: [p3-4-remove-unreferenced-generic-method]
    inputs:
      - {name: generic_method_removed, type: boolean}
      - {name: checks.contractTests, type: string}
      - {name: checks.dependencyDirection, type: string}
    outputs:
      - {name: p3_checks_passed, type: boolean}
```
