---
name: domain-events
description: Use when a state change must reach another bounded context or outside system (email, bus, third-party API), others must learn what happened, or a consumer must survive redelivery or reordering.
metadata:
  aip:
    spec: https://github.com/zach-blumenfeld/aip/tree/v0.3a3
    schemaId: https://raw.githubusercontent.com/zach-blumenfeld/aip/v0.3a3/assets/aip-schemas/procedure.schema.json
---

```yaml
purpose: >
  The aggregate records a past-tense event in the same unit of work as its change (domain-modelling);
  the use case writes it to an outbox table in that transaction (problems 2, 3). A relay publishes
  outbox rows after commit, at least once, with retry (problem 2). Across contexts, an integration
  event: a versioned published contract mapped from the internal event (problems 1, 3). Consumers are
  idempotent and check the aggregate version (problem 4). Inside one context, follow-up work is an
  explicit call in the use case, not an event handler (problem 1). Companion inputs are paths.domain,
  paths.eventList, paths.integrationEvents, paths.consumers, checks.dependencyDirection,
  checks.eventTests and infraModules (bus, mail and third-party clients).
trigger_when:
  - "Problem 1: a state change must trigger work in another bounded context or outside system, and a direct call couples them. Signal: a use case calls another context's API or module after saving."
  - "Problem 2: a side effect outside the database (email, bus, third-party API) runs before commit or without retry. Signal: send or publish inside or right after the transaction, no outbox."
  - "Problem 3: others must learn what happened (another context's projection, audit). Signal: polling or diffing another context's tables."
  - "Problem 4: consumers break on redelivery or reordering. Signal: a handler that increments or inserts with no record of what it processed."
do_not_use_when:
  - "The reaction lives in the same context and the same transaction: call it explicitly."
  - "No consumer exists yet: record the event (domain-modelling), publish nothing."
scope_and_approval: >
  Rule 1: an event is a past-tense fact from the domain's event list, never a command in disguise
  (SendWelcomeEmail). Rule 2: an event is written to the outbox in the change's transaction; nothing
  publishes directly. Rule 3: only the relay publishes, after commit, at least once. Rule 4: a
  consumer records the event id it processed in the same transaction as its effect. Rule 5: a
  consumer ignores an event older than the aggregate version it has seen; no ordering is assumed
  across aggregates. Rule 6: internal events never leave their context; other contexts get an
  integration event, a published contract with one producer. Rule 7: a contract carries ids and the
  facts of the change; carrying state for consumers is a declared choice in the contract. Rule 8:
  contract changes are additive; a breaking change is a new version. Rule 9: a failing consumer
  retries, then lands in a dead-letter with an alert; never silently dropped.
anti_patterns:
  - "Dual write: save, then publish to the bus."
  - "Dispatch before commit: an email for an order that rolled back."
  - "A command disguised as an event."
  - "Chains of in-process handlers that hide the flow."
  - "Internal domain events published to other contexts, coupling them to the model."
  - "A consumer that double-applies on redelivery."
  - "The whole aggregate as payload by default."
  - "Integration events published \"for later\" with no consumer."
  - "Consumer failures swallowed."
steps:
  - name: p0-1-scan-infra-imports
    description: P0 step 1 (script). Parse paths.domain and use cases for imports of bus, mail or third-party clients from infraModules (rule 2).
    script: scripts/scan_infra_imports.py
    inputs:
      - {name: paths.domain, type: "list[string]", description: "Domain model and use cases, from the companion."}
      - {name: infraModules, type: "list[string]", description: "Bus, mail and third-party client modules, from the companion."}
    outputs:
      - {name: violations, type: "list[object]", description: "Files breaking rule 2, each with path, imports and rule."}
  - name: p0-2-check-problems
    description: P0 step 2 (agent). Check the task for problems 1-4.
    depends_on: [p0-1-scan-infra-imports]
    inputs:
      - {name: task, type: object, description: Task and acceptance criteria.}
      - {name: violations, type: "list[object]"}
    outputs:
      - {name: problems, type: "list[integer]", description: Problem numbers 1-4 that hold.}
  - name: p0-3-decide-applies
    description: P0 step 3 (agent). The task touches a direct publish or an in-process handler chain -> applies (P4); reaction in the same context and transaction -> stop, explicit call; no problems -> stop; else applies.
    depends_on: [p0-2-check-problems]
    inputs:
      - {name: problems, type: "list[integer]"}
      - {name: task, type: object}
      - {name: violations, type: "list[object]"}
    outputs:
      - {name: applies, type: boolean, description: "True when a later procedure runs; false means stop."}
  - name: p1-1-name-event
    description: P1 step 1 (agent). Name the fact in past tense; add it to paths.eventList first.
    depends_on: [p0-3-decide-applies]
    inputs:
      - {name: applies, type: boolean}
      - {name: task, type: object}
      - {name: paths.eventList, type: string}
    outputs:
      - {name: event_spec, type: object, description: "The event's past-tense name and its facts, listed in paths.eventList."}
  - name: p1-2-write-outbox-scenarios
    description: "P1 step 2 (agent). Scenarios: change commits -> one outbox row; change rolls back -> none."
    depends_on: [p1-1-name-event]
    inputs:
      - {name: event_spec, type: object}
    outputs:
      - {name: failing_outbox_tests, type: "list[string]"}
  - name: p1-3-record-and-write-outbox
    description: P1 step 3 (agent). The aggregate records the event; the use case writes it to the outbox in the unit of work.
    depends_on: [p1-2-write-outbox-scenarios]
    inputs:
      - {name: failing_outbox_tests, type: "list[string]"}
      - {name: paths.domain, type: "list[string]"}
    outputs:
      - {name: outbox_write, type: string, description: Where the use case writes the event in its transaction.}
  - name: p1-4-relay
    description: P1 step 4 (agent). Relay publishes after commit with retry (reuse an existing relay).
    depends_on: [p1-3-record-and-write-outbox]
    inputs:
      - {name: outbox_write, type: string}
    outputs:
      - {name: relay, type: string, description: The relay that publishes outbox rows after commit.}
  - name: p1-5-run-direction-and-event-tests
    description: P1 step 5 (script). Run checks.dependencyDirection and checks.eventTests.
    script: scripts/run_check.py
    depends_on: [p1-4-relay]
    inputs:
      - {name: relay, type: string}
      - {name: checks.dependencyDirection, type: string}
      - {name: checks.eventTests, type: string}
    outputs:
      - {name: p1_checks, type: object, description: "passed, and each command's exit and output."}
  - name: p2-1-name-consumer-need
    description: P2 step 1 (agent). Name the consumer and its need; none -> stop.
    depends_on: [p0-3-decide-applies]
    inputs:
      - {name: applies, type: boolean}
      - {name: task, type: object}
    outputs:
      - {name: consumer_need, type: object, description: The consuming context and the facts it needs.}
  - name: p2-2-write-contract
    description: "P2 step 2 (agent). Contract in paths.integrationEvents: name, version, the fields the need requires; state transfer declared if carried."
    depends_on: [p2-1-name-consumer-need]
    inputs:
      - {name: consumer_need, type: object}
      - {name: paths.integrationEvents, type: string}
    outputs:
      - {name: contract_spec, type: object, description: "Contract name, version and fields."}
  - name: p2-3-contract-test
    description: P2 step 3 (agent). Contract test on the payload.
    depends_on: [p2-2-write-contract]
    inputs:
      - {name: contract_spec, type: object}
    outputs:
      - {name: contract_test, type: string}
  - name: p2-4-map-in-relay
    description: P2 step 4 (agent). Relay maps the internal event to the contract.
    depends_on: [p2-3-contract-test]
    inputs:
      - {name: contract_test, type: string}
      - {name: contract_spec, type: object}
    outputs:
      - {name: relay_mapping, type: string}
  - name: p2-5-run-direction-and-event-tests
    description: P2 step 5 (script). Run checks.dependencyDirection and checks.eventTests.
    script: scripts/run_check.py
    depends_on: [p2-4-map-in-relay]
    inputs:
      - {name: relay_mapping, type: string}
      - {name: checks.dependencyDirection, type: string}
      - {name: checks.eventTests, type: string}
    outputs:
      - {name: p2_checks, type: object}
  - name: p3-1-write-consumer-scenarios
    description: "P3 step 1 (agent). Scenarios: event once -> effect once; same event twice -> effect once; older version after newer -> ignored; handler failure -> retried, then dead-letter."
    depends_on: [p0-3-decide-applies]
    inputs:
      - {name: applies, type: boolean}
      - {name: task, type: object}
      - {name: paths.consumers, type: string}
    outputs:
      - {name: failing_consumer_tests, type: "list[string]"}
  - name: p3-2-record-processed-event
    description: P3 step 2 (agent). Handler records the processed event id in the effect's transaction.
    depends_on: [p3-1-write-consumer-scenarios]
    inputs:
      - {name: failing_consumer_tests, type: "list[string]"}
    outputs:
      - {name: idempotent_handler, type: string}
  - name: p3-3-retry-and-dead-letter
    description: P3 step 3 (agent). Retry, then dead-letter with alert.
    depends_on: [p3-2-record-processed-event]
    inputs:
      - {name: idempotent_handler, type: string}
    outputs:
      - {name: failure_path, type: string, description: "Retry policy, dead-letter and alert."}
  - name: p3-4-run-direction-and-event-tests
    description: P3 step 4 (script). Run checks.dependencyDirection and checks.eventTests.
    script: scripts/run_check.py
    depends_on: [p3-3-retry-and-dead-letter]
    inputs:
      - {name: failure_path, type: string}
      - {name: checks.dependencyDirection, type: string}
      - {name: checks.eventTests, type: string}
    outputs:
      - {name: p3_checks, type: object}
  - name: p4-1-scope-touched-paths
    description: P4 step 1 (agent). Scope = the direct publishes or in-process handler chains the task touches; everything else stays unchanged.
    depends_on: [p0-3-decide-applies]
    inputs:
      - {name: applies, type: boolean}
      - {name: task, type: object}
      - {name: violations, type: "list[object]"}
    outputs:
      - {name: scope_list, type: "list[string]"}
  - name: p4-2-replace-each
    description: P4 step 2 (agent). Direct publish -> P1; same-transaction handler -> explicit call in the use case.
    depends_on: [p4-1-scope-touched-paths]
    inputs:
      - {name: scope_list, type: "list[string]"}
    outputs:
      - {name: replaced, type: "list[string]"}
  - name: p4-3-remove-unused-old-path
    description: P4 step 3 (agent). Remove the old path only when nothing uses it.
    depends_on: [p4-2-replace-each]
    inputs:
      - {name: replaced, type: "list[string]"}
    outputs:
      - {name: removed, type: "list[string]"}
  - name: p4-4-run-direction-and-event-tests
    description: P4 step 4 (script). Run checks.dependencyDirection and checks.eventTests.
    script: scripts/run_check.py
    depends_on: [p4-3-remove-unused-old-path]
    inputs:
      - {name: removed, type: "list[string]"}
      - {name: checks.dependencyDirection, type: string}
      - {name: checks.eventTests, type: string}
    outputs:
      - {name: p4_checks, type: object}
```
